import { describe, expect, it } from 'vitest';
import { topicFromFilename } from '../tools/youtube-short.js';
import { TAG_BLACKLIST, fmtViews, normalizeTag } from './hashtags.js';
import { scoreYouTubeTitle } from '@spark-apps/video-kit';

describe('normalizeTag', () => {
  it('lowercases, strips spaces and symbols, caps at 30 chars', () => {
    expect(normalizeTag('Blender 3D')).toBe('#blender3d');
    expect(normalizeTag('#GameDev!')).toBe('#gamedev');
    expect(normalizeTag('x'.repeat(50))).toHaveLength(31); // # + 30
  });
});

describe('fmtViews', () => {
  it('abbreviates like YouTube does', () => {
    expect(fmtViews(2_400_000)).toBe('2.4M');
    expect(fmtViews(15_300)).toBe('15K');
    expect(fmtViews(950)).toBe('950');
  });
});

describe('TAG_BLACKLIST', () => {
  it('blocks the generic spam tags', () => {
    for (const t of ['#shorts', '#viral', '#fyp']) expect(TAG_BLACKLIST.has(t)).toBe(true);
    expect(TAG_BLACKLIST.has('#blender3d')).toBe(false);
  });
});

describe('scoreYouTubeTitle (ported model sanity)', () => {
  it('rewards the known-good shape over a bare fragment', () => {
    const good = scoreYouTubeTitle('How I Rigged a Duck in Blender in 20 Minutes (FREE Guide)');
    const bad = scoreYouTubeTitle('duck video');
    expect(good.total).toBeGreaterThan(bad.total);
    expect(good.grade < bad.grade || good.total > 80).toBe(true);
  });

  it('penalises emoji', () => {
    const clean = scoreYouTubeTitle('How to Rig a Duck in Blender (Easy)');
    const emoji = scoreYouTubeTitle('How to Rig a Duck in Blender (Easy) 🦆');
    expect(emoji.total).toBeLessThan(clean.total);
  });
});

describe('topicFromFilename', () => {
  it('recovers a readable topic from a slug', () => {
    expect(topicFromFilename('/x/tax-ducks-mascot-blender-11.mp4')).toBe(
      'tax ducks mascot blender'
    );
  });
});
