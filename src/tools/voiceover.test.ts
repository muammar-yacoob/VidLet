import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_VOICE, resolveVoice } from '../lib/edge-tts.js';
import { MAX_SCRIPT_LENGTH, buildDuckFilter, resolveScriptText, uniquePath } from './voiceover.js';

const tmp = mkdtempSync(join(tmpdir(), 'vidlet-voiceover-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('resolveVoice', () => {
  it('defaults to English female', () => {
    expect(resolveVoice()).toBe(DEFAULT_VOICE);
  });

  it('resolves language and gender', () => {
    expect(resolveVoice('de', 'male')).toBe('de-DE-FlorianMultilingualNeural');
    expect(resolveVoice('ja')).toBe('ja-JP-NanamiNeural');
  });

  it('falls back to English for unknown languages', () => {
    expect(resolveVoice('xx', 'male')).toBe(DEFAULT_VOICE);
  });

  it('normalizes locale-style codes', () => {
    expect(resolveVoice('EN-us')).toBe(DEFAULT_VOICE);
  });
});

describe('resolveScriptText', () => {
  it('treats plain text as the script', () => {
    expect(resolveScriptText('  Hello world  ')).toBe('Hello world');
  });

  it('reads .txt files', () => {
    const file = join(tmp, 'script.txt');
    writeFileSync(file, 'From a file.\n');
    expect(resolveScriptText(file)).toBe('From a file.');
  });

  it('rejects empty scripts', () => {
    expect(() => resolveScriptText('   ')).toThrow(/empty/i);
  });

  it('rejects scripts over the limit', () => {
    expect(() => resolveScriptText('a'.repeat(MAX_SCRIPT_LENGTH + 1))).toThrow(/too long/i);
  });
});

describe('uniquePath', () => {
  it('returns the path unchanged when free', () => {
    expect(uniquePath(join(tmp, 'fresh.mp3'))).toBe(join(tmp, 'fresh.mp3'));
  });

  it('numbers collisions', () => {
    const taken = join(tmp, 'taken.mp3');
    writeFileSync(taken, '');
    expect(uniquePath(taken)).toBe(join(tmp, 'taken-1.mp3'));
  });
});

describe('buildDuckFilter', () => {
  it('splits narration, ducks the original, and mixes', () => {
    const filter = buildDuckFilter();
    expect(filter).toContain('asplit');
    expect(filter).toContain('sidechaincompress');
    expect(filter).toContain('amix=inputs=2:duration=first');
    expect(filter.endsWith('[out]')).toBe(true);
  });

  it('silence-pads the narration so the mix spans the full video', () => {
    // Regression: without apad, sidechaincompress EOFs at narration end and
    // the output video is truncated to the narration length.
    expect(buildDuckFilter()).toContain('apad');
  });
});
