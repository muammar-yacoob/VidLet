import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gateHandlers } from './gate.js';
import type { ToolResult } from './shared.js';

// The meter and the entitlement cache both live under $HOME. Point HOME at a
// throwaway dir so these tests never read or write the developer's real
// ~/.config/vidlet, and so each test starts with an empty allowance.
let home: string;
let realHome: string | undefined;

beforeEach(() => {
  realHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'vidlet-gate-'));
  process.env.HOME = home;
  delete process.env.VIDLET_EMAIL; // no account => free tier, no network call
});

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

const ok = async (): Promise<ToolResult> => ({ content: [{ type: 'text', text: 'ok' }] });
const boom = async (): Promise<ToolResult> => {
  throw new Error('handler exploded');
};

const textOf = (r: ToolResult) => (r.content[0] as { text: string }).text;

describe('feature gates', () => {
  it('blocks a Studio-only tool on the free tier and names the tier that unlocks it', async () => {
    const gated = gateHandlers({ upload_to_youtube: ok });
    const res = await gated.upload_to_youtube({});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('included in Studio');
  });

  it('lets an ungated tool through', async () => {
    const gated = gateHandlers({ probe_video: ok });
    expect((await gated.probe_video({})).isError).toBeUndefined();
  });

  it("does not spend the day's allowance on a call it refused", async () => {
    const gated = gateHandlers({ upload_to_youtube: ok, probe_video: ok });
    for (let i = 0; i < 5; i++) await gated.upload_to_youtube({});
    // All 10 free calls should still be available.
    for (let i = 0; i < 10; i++) {
      expect((await gated.probe_video({})).isError).toBeUndefined();
    }
  });
});

/**
 * Put the caller on an unexpired trial by seeding the on-disk entitlement
 * cache, which getEntitlement reads before it would reach the network. Keeps
 * these tests offline and deterministic.
 */
function seedTrial(onTrial: boolean, tier: 'free' | 'pro' = 'free'): void {
  const email = 'trial@example.com';
  process.env.VIDLET_EMAIL = email;
  const dir = join(home, '.config', 'vidlet');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'entitlement.json'),
    JSON.stringify({ email, tier, onTrial, at: Date.now() })
  );
}

describe('trial allowance', () => {
  it('lets a trial connect a channel its tier has not bought', async () => {
    seedTrial(true);
    const gated = gateHandlers({ connect_youtube: ok });
    expect((await gated.connect_youtube({})).isError).toBeUndefined();
  });

  it('keeps A/B rotation paid even on a trial', async () => {
    seedTrial(true);
    const gated = gateHandlers({ rotate_youtube_test: ok });
    const res = await gated.rotate_youtube_test({});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('Upgrade');
  });

  it('allows five trial uploads, then points at the paid plan', async () => {
    seedTrial(true);
    const gated = gateHandlers({ upload_to_youtube: ok });
    for (let i = 1; i <= 5; i++) {
      expect((await gated.upload_to_youtube({})).isError, `upload ${i}`).toBeUndefined();
    }
    const over = await gated.upload_to_youtube({});
    expect(over.isError).toBe(true);
    expect(textOf(over)).toContain('5/5');
  });

  it('does not spend the allowance on an upload that failed', async () => {
    seedTrial(true);
    const gated = gateHandlers({ upload_to_youtube: boom });
    for (let i = 0; i < 3; i++) {
      await expect(gated.upload_to_youtube({})).rejects.toThrow('handler exploded');
    }
    const good = gateHandlers({ upload_to_youtube: ok });
    // All five should still be there.
    for (let i = 1; i <= 5; i++) {
      expect((await good.upload_to_youtube({})).isError, `upload ${i}`).toBeUndefined();
    }
  });

  it('does not hand back a fresh allowance when the UTC day rolls over', async () => {
    seedTrial(true);
    const gated = gateHandlers({ upload_to_youtube: ok });
    for (let i = 0; i < 5; i++) await gated.upload_to_youtube({});

    // Forge yesterday's daily bucket while keeping the lifetime totals: this
    // is exactly the file the next calendar day would read.
    const usage = join(home, '.config', 'vidlet', 'usage.json');
    const state = JSON.parse(readFileSync(usage, 'utf-8'));
    writeFileSync(usage, JSON.stringify({ ...state, day: '1999-01-01' }));

    const over = await gated.upload_to_youtube({});
    expect(over.isError).toBe(true);
    expect(textOf(over)).toContain('5/5');
  });

  it('refuses the same tools when no trial is running', async () => {
    seedTrial(false);
    const gated = gateHandlers({ connect_youtube: ok, upload_to_youtube: ok });
    expect((await gated.connect_youtube({})).isError).toBe(true);
    expect((await gated.upload_to_youtube({})).isError).toBe(true);
  });
});

describe('daily meter', () => {
  it('allows exactly 10 free calls a day, then blocks with a reset hint', async () => {
    const gated = gateHandlers({ probe_video: ok });
    for (let i = 1; i <= 10; i++) {
      expect((await gated.probe_video({})).isError, `call ${i}`).toBeUndefined();
    }
    const over = await gated.probe_video({});
    expect(over.isError).toBe(true);
    expect(textOf(over)).toContain('10/10');
    expect(textOf(over)).toContain('00:00 UTC');
  });

  it('counts a handler that throws, so a crashing tool cannot be hammered for free', async () => {
    const gated = gateHandlers({ probe_video: boom, trim_video: ok });
    for (let i = 0; i < 10; i++) {
      await expect(gated.probe_video({})).rejects.toThrow('handler exploded');
    }
    const after = await gated.trim_video({});
    expect(after.isError).toBe(true);
    expect(textOf(after)).toContain('Daily MCP limit');
  });

  it('never meters discovery', async () => {
    const gated = gateHandlers({ list_capabilities: ok, probe_video: ok });
    for (let i = 0; i < 25; i++) {
      expect((await gated.list_capabilities({})).isError).toBeUndefined();
    }
    expect((await gated.probe_video({})).isError).toBeUndefined();
  });
});
