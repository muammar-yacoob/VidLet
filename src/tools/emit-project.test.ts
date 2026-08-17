import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkFFmpeg } from '../lib/ffmpeg.js';
import { parseProject } from '../lib/vidlet-project.js';
import { emitVidletProject, projectPathFor } from './emit-project.js';

const hasFFmpeg = await checkFFmpeg();
const dir = mkdtempSync(join(tmpdir(), 'vidlet-emit-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('projectPathFor', () => {
  it('sits beside the render with the same stem', () => {
    expect(projectPathFor('/x/y/short.mp4')).toBe('/x/y/short.vidlet');
  });

  it('handles a stem containing dots', () => {
    expect(projectPathFor('/x/my.short.v2.mp4')).toBe('/x/my.short.v2.vidlet');
  });
});

describe('emitted timeline maths', () => {
  // The invariant the format has to satisfy: a clip's TIMELINE duration is
  // the source span divided by the speed it plays at. Getting this backwards
  // makes a 21x timelapse render 21x too long.
  it('lays sped-up spans end to end to the expected total', () => {
    const spans = [
      { start: 5, end: 105 }, // 100s of source
      { start: 200, end: 300 }, // 100s of source
    ];
    const speed = 20;
    const intro = 6;
    let timeline = intro;
    const clips = spans.map((s) => {
      const onTimeline = (s.end - s.start) / speed;
      const clip = { start: timeline, sourceIn: s.start, duration: onTimeline, speed };
      timeline += onTimeline;
      return clip;
    });
    // 200s of source at 20x is 10s, plus a 6s intro.
    expect(timeline).toBeCloseTo(16, 6);
    expect(clips[0].start).toBe(6);
    expect(clips[1].start).toBeCloseTo(11, 6);
    // Each clip reads span-length of source, not timeline-length.
    for (const c of clips) expect(c.duration * c.speed).toBeCloseTo(100, 6);
  });
});

// Integration: fixture generated from lavfi at test time, like render.test.ts.
describe.runIf(hasFFmpeg)('emitVidletProject options (integration)', () => {
  const clip = join(dir, 'clip.mp4');

  beforeAll(async () => {
    await execa('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=15:d=2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      clip,
    ]);
  });

  it('records keepClipAudio, generator and subtitle style overrides', async () => {
    const out = join(dir, 'captions.vidlet');
    await emitVidletProject({
      output: out,
      title: 'captions',
      width: 320,
      height: 180,
      fps: 15,
      clips: [{ source: clip, spans: [{ start: 0, end: 2 }] }],
      speed: 1,
      introSeconds: 0,
      narration: null,
      music: null,
      subtitles: [
        {
          start: 0,
          end: 1,
          text: 'one two',
          words: [
            { word: 'one', start: 0, end: 0.5 },
            { word: 'two', start: 0.5, end: 1 },
          ],
        },
      ],
      keepClipAudio: true,
      generator: 'vidlet generate_captions',
      subtitleStyle: { captionStyle: 'hormozi', highlightColor: '&H00FFFF&' },
    });

    const project = parseProject(readFileSync(out, 'utf8'));
    expect(project.meta.generator).toBe('vidlet generate_captions');
    // The clip keeps its own audio: this project IS the original video.
    expect(project.tracks.video[0].muted).toBe(false);
    // Explicit style wins over the words-derived 'shorts' default.
    expect(project.subtitles.style.captionStyle).toBe('hormozi');
    expect(project.subtitles.entries[0].words?.length).toBe(2);
    expect(project.media[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('still mutes clips and tags generate_short without the new options', async () => {
    const out = join(dir, 'short.vidlet');
    await emitVidletProject({
      output: out,
      title: 'short',
      width: 320,
      height: 180,
      fps: 15,
      clips: [{ source: clip, spans: [{ start: 0, end: 1 }] }],
      speed: 1,
      introSeconds: 0,
      narration: null,
      music: null,
      subtitles: [],
    });
    const project = parseProject(readFileSync(out, 'utf8'));
    expect(project.meta.generator).toBe('vidlet generate_short');
    expect(project.tracks.video[0].muted).toBe(true);
  });
});
