import { mkdtempSync, rmSync } from 'node:fs';
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

  it('does not spend the day\'s allowance on a call it refused', async () => {
    const gated = gateHandlers({ upload_to_youtube: ok, probe_video: ok });
    for (let i = 0; i < 5; i++) await gated.upload_to_youtube({});
    // All 10 free calls should still be available.
    for (let i = 0; i < 10; i++) {
      expect((await gated.probe_video({})).isError).toBeUndefined();
    }
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
