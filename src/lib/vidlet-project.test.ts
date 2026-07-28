import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  parseProject,
  projectDuration,
  resolveProjectMedia,
  serializeProject,
  sha256File,
} from './vidlet-project.js';

const tmp = mkdtempSync(join(tmpdir(), 'vidlet-project-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Minimal valid v1 project, overridable per test. */
function fixture(overrides: Record<string, unknown> = {}) {
  return {
    vidlet: 1,
    meta: {
      title: 'Test',
      createdAt: '2026-07-28T10:00:00Z',
      modifiedAt: '2026-07-28T10:00:00Z',
      generator: 'test/1.0',
    },
    settings: { width: 1920, height: 1080, fps: 30, background: '#000000' },
    media: [],
    tracks: { video: [], overlay: [], voice: [], music: [], sfx: [] },
    subtitles: {
      style: {
        fontFamily: 'Arial',
        fontSize: 28,
        color: '#FFFFFF',
        position: 'bottom',
        outline: true,
      },
      entries: [],
    },
    ...overrides,
  };
}

describe('parseProject', () => {
  it('parses a minimal project', () => {
    const project = parseProject(JSON.stringify(fixture()));
    expect(project.meta.title).toBe('Test');
    expect(project.settings.fps).toBe(30);
  });

  it('fills spec defaults on clips', () => {
    const project = parseProject(
      JSON.stringify(
        fixture({
          tracks: {
            video: [{ id: 'c1', mediaId: 'm1', start: 0, duration: 2 }],
            overlay: [{ id: 'o1', mediaId: 'm1', start: 1, duration: 1 }],
            voice: [{ id: 'v1', mediaId: 'm1', start: 0, duration: 2 }],
            music: [{ id: 'mu1', mediaId: 'm1', start: 0, duration: 2 }],
            sfx: [],
          },
        })
      )
    );
    const [video] = project.tracks.video;
    expect(video.sourceIn).toBe(0);
    expect(video.gain).toBe(1);
    expect(video.muted).toBe(false);
    const [overlay] = project.tracks.overlay;
    expect(overlay.x).toBe(0);
    expect(overlay.y).toBe(0);
    expect(overlay.scale).toBe(0.3);
    expect(overlay.opacity).toBe(1);
    expect(overlay.loop).toBe(false);
    expect(overlay.fit).toBe('free');
    // ducking defaults true only on the voice track
    expect(project.tracks.voice[0].ducking).toBe(true);
    expect(project.tracks.music[0].ducking).toBe(false);
    expect(project.tracks.voice[0].fadeIn).toBe(0);
    expect(project.tracks.voice[0].fadeOut).toBe(0);
    expect(project.tracks.voice[0].loop).toBe(false);
  });

  it('refuses files made by a newer Vidlet', () => {
    expect(() => parseProject(JSON.stringify(fixture({ vidlet: 2 })))).toThrow(/newer Vidlet/);
    expect(() => parseProject(JSON.stringify(fixture({ vidlet: 7 })))).toThrow(/newer Vidlet/);
  });

  it('rejects invalid JSON with a readable message', () => {
    expect(() => parseProject('{nope')).toThrow(/not valid JSON/);
  });

  it('names the offending field in validation errors', () => {
    const bad = fixture() as Record<string, unknown>;
    (bad.settings as Record<string, unknown>).fps = 0;
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/settings\.fps/);
  });

  it('preserves unknown fields for round-tripping', () => {
    const input = fixture({
      x_custom: { future: true },
      tracks: {
        video: [{ id: 'c1', mediaId: 'm1', start: 0, duration: 2, transition: 'fade' }],
        overlay: [],
        voice: [],
        music: [],
        sfx: [],
      },
    }) as Record<string, unknown>;
    (input.meta as Record<string, unknown>).x_note = 'keep me';
    const project = parseProject(JSON.stringify(input));
    const roundTripped = serializeProject(project);
    expect(roundTripped).toContain('"x_custom"');
    expect(roundTripped).toContain('"transition": "fade"');
    expect(roundTripped).toContain('"x_note": "keep me"');
  });
});

describe('projectDuration', () => {
  it('is the max clip end or subtitle end across all tracks', () => {
    const project = parseProject(
      JSON.stringify(
        fixture({
          tracks: {
            video: [{ id: 'c1', mediaId: 'm1', start: 0, duration: 2 }],
            overlay: [],
            voice: [{ id: 'v1', mediaId: 'm1', start: 1, duration: 3.5 }],
            music: [],
            sfx: [],
          },
          subtitles: {
            style: {
              fontFamily: 'Arial',
              fontSize: 28,
              color: '#FFFFFF',
              position: 'bottom',
              outline: true,
            },
            entries: [{ id: 's1', start: 0, end: 5, text: 'longest' }],
          },
        })
      )
    );
    expect(projectDuration(project)).toBe(5);
  });
});

describe('resolveProjectMedia', () => {
  it('finds media via relative path, verifies sha256, and falls back to name', async () => {
    const dir = join(tmp, 'proj');
    rmSync(dir, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'media'), { recursive: true });
    writeFileSync(join(dir, 'media', 'a.mp4'), 'AAAA');
    writeFileSync(join(dir, 'b.mp4'), 'BBBB');
    const shaA = await sha256File(join(dir, 'media', 'a.mp4'));
    const projectPath = join(dir, 'test.vidlet');
    writeFileSync(projectPath, '{}');

    const project = parseProject(
      JSON.stringify(
        fixture({
          media: [
            { id: 'a', kind: 'video', name: 'a.mp4', bytes: 4, sha256: shaA, path: 'media/a.mp4' },
            { id: 'b', kind: 'video', name: 'b.mp4', bytes: 4 }, // no path: found by name
            { id: 'c', kind: 'audio', name: 'gone.mp3', bytes: 9, path: 'media/gone.mp3' },
          ],
        })
      )
    );
    const { files, warnings, missing } = await resolveProjectMedia(project, projectPath);
    expect(files.get('a')).toBe(join(dir, 'media', 'a.mp4'));
    expect(files.get('b')).toBe(join(dir, 'b.mp4'));
    expect(warnings).toEqual([]);
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe('gone.mp3');
    expect(missing[0].hint).toContain('media/gone.mp3');
  });

  it('warns (does not fail) on sha256 mismatch', async () => {
    const dir = join(tmp, 'mismatch');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.mp4'), 'CHANGED CONTENT');
    const projectPath = join(dir, 'test.vidlet');
    writeFileSync(projectPath, '{}');
    const project = parseProject(
      JSON.stringify(
        fixture({
          media: [{ id: 'a', kind: 'video', name: 'a.mp4', bytes: 15, sha256: 'f'.repeat(64) }],
        })
      )
    );
    const { files, warnings, missing } = await resolveProjectMedia(project, projectPath);
    expect(files.get('a')).toBe(join(dir, 'a.mp4'));
    expect(missing).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/sha256 mismatch/);
  });
});

describe('sha256File', () => {
  it('hashes file contents', async () => {
    const file = join(tmp, 'hash.txt');
    writeFileSync(file, 'hello');
    // echo -n hello | sha256sum
    expect(await sha256File(file)).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });
});
