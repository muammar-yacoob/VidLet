import { describe, expect, it } from 'vitest';
import { buildMusicGraph } from './add-music.js';

const base = {
  hasSourceAudio: true,
  duration: 57,
  volume: 0.08,
  duck: true,
  fadeIn: 1.5,
  fadeOut: 2,
};

describe('buildMusicGraph', () => {
  it('pads the source audio so a short narration cannot truncate the video', () => {
    // Regression: without apad, a 43s voice track over 57s of picture made
    // the mix end early and the output was cut to the narration.
    expect(buildMusicGraph(base)).toContain('apad');
  });

  it('bounds the mix to the video duration', () => {
    expect(buildMusicGraph(base)).toContain('atrim=0:57.000');
  });

  it('splits the voice so the sidechain key does not consume the mix input', () => {
    const g = buildMusicGraph(base);
    expect(g).toContain('asplit=2[vmix][vkey]');
    expect(g).toContain('[bed][vkey]sidechaincompress');
    expect(g).toContain('[duckedbed][vmix]amix');
  });

  it('skips the compressor when ducking is off but still mixes', () => {
    const g = buildMusicGraph({ ...base, duck: false });
    expect(g).not.toContain('sidechaincompress');
    expect(g).toContain('amix=inputs=2');
  });

  it('uses the bed alone when the video is silent', () => {
    const g = buildMusicGraph({ ...base, hasSourceAudio: false });
    expect(g).toContain('[bed]anull[a]');
    expect(g).not.toContain('amix');
  });

  it('starts the fade-out before the end, never at a negative time', () => {
    expect(buildMusicGraph(base)).toContain('afade=t=out:st=55.000');
    expect(buildMusicGraph({ ...base, duration: 1 })).toContain('afade=t=out:st=0.000');
  });

  it('applies the requested bed level', () => {
    expect(buildMusicGraph({ ...base, volume: 0.2 })).toContain('volume=0.2');
  });
});
