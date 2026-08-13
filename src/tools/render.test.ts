import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { parseProject, sha256File } from '../lib/vidlet-project.js';
import { buildSubtitleAss, parseResolution, renderProject } from './render.js';

const hasFFmpeg = await checkFFmpeg();

describe('parseResolution', () => {
  const base = { width: 1920, height: 1080 };
  it('accepts WIDTHxHEIGHT', () => {
    expect(parseResolution('1280x720', base)).toEqual({ width: 1280, height: 720 });
  });
  it('accepts NNNp, keeping the canvas aspect and rounding even', () => {
    expect(parseResolution('720p', base)).toEqual({ width: 1280, height: 720 });
    expect(parseResolution('540p', { width: 1080, height: 1920 })).toEqual({
      width: 304,
      height: 540,
    });
  });
  it('rejects nonsense', () => {
    expect(() => parseResolution('big', base)).toThrow(/resolution/i);
  });
});

describe('buildSubtitleAss', () => {
  it('maps the style block to ASS and returns null with no entries', () => {
    const project = parseProject(
      JSON.stringify({
        vidlet: 1,
        meta: { title: 't', createdAt: 'x', modifiedAt: 'x', generator: 'g' },
        settings: { width: 640, height: 360, fps: 30, background: '#000000' },
        media: [],
        tracks: { video: [], overlay: [], voice: [], music: [], sfx: [] },
        subtitles: {
          style: {
            fontFamily: 'Verdana',
            fontSize: 36,
            color: '#FFEE00',
            position: 'top',
            outline: true,
          },
          entries: [{ id: 's1', start: 0.5, end: 2, text: 'Hi\nthere' }],
        },
      })
    );
    const ass = buildSubtitleAss(project, { width: 640, height: 360 });
    expect(ass).toContain('PlayResX: 640');
    expect(ass).toContain('&H0000EEFF'); // #FFEE00 -> BGR
    expect(ass).toContain('Verdana');
    expect(ass).toContain('Hi\\Nthere');
    expect(ass).toMatch(/Alignment.*\n.*,8,/); // top alignment in the style line

    project.subtitles.entries = [];
    expect(buildSubtitleAss(project, { width: 640, height: 360 })).toBeNull();
  });

  const wordLitProject = (style?: Record<string, unknown>, words?: unknown) =>
    parseProject(
      JSON.stringify({
        vidlet: 1,
        meta: { title: 't', createdAt: 'x', modifiedAt: 'x', generator: 'g' },
        settings: { width: 720, height: 1280, fps: 30, background: '#000000' },
        media: [],
        tracks: { video: [], overlay: [], voice: [], music: [], sfx: [] },
        subtitles: {
          style: {
            fontFamily: 'DejaVu Sans',
            fontSize: 64,
            color: '#FFFFFF',
            position: 'bottom',
            outline: true,
            ...style,
          },
          entries: [{ id: 's1', start: 0, end: 2, text: 'one two', ...(words ? { words } : {}) }],
        },
      })
    );

  const canvas = { width: 720, height: 1280 };

  it('stays plain when the project records no caption style', () => {
    // The old behaviour, and the reason a Short round-tripped to flat blocks.
    const ass = buildSubtitleAss(wordLitProject(), canvas);
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,one two');
  });

  it('renders word-lit captions when the project records the shorts style', () => {
    const ass = buildSubtitleAss(wordLitProject({ captionStyle: 'shorts' }), canvas) ?? '';
    // One Dialogue event per word, so exactly one word is lit at a time.
    expect(ass.match(/^Dialogue:/gm)?.length).toBe(2);
    expect(ass).toContain('Style: Shorts');
  });

  it('honours an override for projects written before the style was stored', () => {
    const ass = buildSubtitleAss(wordLitProject(), canvas, 'shorts') ?? '';
    expect(ass).toContain('Style: Shorts');
    expect(ass.match(/^Dialogue:/gm)?.length).toBe(2);
  });

  it('uses stored word timings rather than interpolating', () => {
    const stored = buildSubtitleAss(
      wordLitProject({ captionStyle: 'shorts' }, [
        { word: 'one', start: 0, end: 1.6 },
        { word: 'two', start: 1.6, end: 2 },
      ]),
      canvas
    );
    // Even distribution would split at 1.0; the stored timing splits at 1.6.
    expect(stored).toContain('0:00:01.60');
    expect(buildSubtitleAss(wordLitProject({ captionStyle: 'shorts' }), canvas)).toContain(
      '0:00:01.00'
    );
  });

  it('carries the project highlight colour into the lit word', () => {
    const ass =
      buildSubtitleAss(
        wordLitProject({ captionStyle: 'shorts', highlightColor: '&H0000FF&' }),
        canvas
      ) ?? '';
    expect(ass).toContain('&H0000FF&');
  });
});

// Integration: only when a system ffmpeg exists. Fixtures are generated at
// test time from lavfi sources — no binaries in the repo.
describe.runIf(hasFFmpeg)('renderProject (integration)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vidlet-render-test-'));
  const clip = join(tmp, 'clip.mp4');
  const voice = join(tmp, 'voice.m4a');
  const music = join(tmp, 'music.m4a');
  const projectPath = join(tmp, 'demo.vidlet');

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  beforeAll(async () => {
    await execa('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=15:d=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:d=4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      clip,
    ]);
    await execa('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=48000:d=3',
      '-c:a',
      'aac',
      voice,
    ]);
    await execa('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:sample_rate=48000:d=1.5',
      '-c:a',
      'aac',
      music,
    ]);

    const media = await Promise.all(
      [
        { id: 'm1', kind: 'video', file: clip },
        { id: 'm2', kind: 'audio', file: voice },
        { id: 'm3', kind: 'audio', file: music },
      ].map(async (m) => ({
        id: m.id,
        kind: m.kind,
        name: m.file.split('/').pop(),
        bytes: statSync(m.file).size,
        sha256: await sha256File(m.file),
        path: m.file.split('/').pop(),
      }))
    );

    writeFileSync(
      projectPath,
      JSON.stringify({
        vidlet: 1,
        meta: {
          title: 'demo',
          createdAt: '2026-07-28T10:00:00Z',
          modifiedAt: '2026-07-28T10:00:00Z',
          generator: 'test/1.0',
        },
        settings: { width: 320, height: 180, fps: 15, background: '#101010' },
        media,
        tracks: {
          // main clip covers 0..2.5, then a background gap to 3.0
          video: [{ id: 'c1', mediaId: 'm1', start: 0, sourceIn: 0.5, duration: 2.5, gain: 0.8 }],
          // free-fit overlay reusing the main clip, semi-transparent
          overlay: [
            {
              id: 'o1',
              mediaId: 'm1',
              start: 0.5,
              duration: 1,
              scale: 0.25,
              x: 0.1,
              y: 0.1,
              opacity: 0.6,
            },
          ],
          // ducking narration bus (default ducking: true on voice)
          voice: [{ id: 'v1', mediaId: 'm2', start: 0, duration: 3 }],
          // looped music: 1.5s media tiled across a 3s clip, faded out
          music: [
            {
              id: 'mu1',
              mediaId: 'm3',
              start: 0,
              duration: 3,
              loop: true,
              gain: 0.5,
              fadeOut: 0.5,
            },
          ],
          sfx: [],
        },
        subtitles: {
          style: {
            fontFamily: 'Arial',
            fontSize: 24,
            color: '#FFFFFF',
            position: 'bottom',
            outline: true,
          },
          entries: [{ id: 's1', start: 0.2, end: 1.8, text: 'Integration test' }],
        },
      })
    );
  }, 120_000);

  it('renders end to end with the duration the project promises', async () => {
    const output = join(tmp, 'out.mp4');
    const result = await renderProject({ projectPath, output, draft: true });

    expect(result.output).toBe(output);
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(1000);
    expect(result.encoder).toContain('libx264');

    // Project duration = max clip end = 3.0s (voice/music), main track 2.5s + gap.
    const info = await getVideoInfo(output);
    expect(Math.abs(info.duration - 3)).toBeLessThan(0.1);
    expect(info.width).toBe(320);
    expect(info.height).toBe(180);
    expect(info.hasAudio).toBe(true);
  }, 180_000);
});
