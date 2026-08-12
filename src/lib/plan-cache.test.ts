import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { planKey } from './plan-cache.js';

const dir = mkdtempSync(join(tmpdir(), 'vidlet-plancache-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeFile(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

describe('planKey', () => {
  it('is stable for identical inputs and settings', () => {
    const f = makeFile('a.mp4', 'x');
    expect(planKey([f], { keepVoice: true })).toBe(planKey([f], { keepVoice: true }));
  });

  it('is insensitive to key ORDER in the settings object', () => {
    const f = makeFile('order.mp4', 'x');
    expect(planKey([f], { a: 1, b: 2 })).toBe(planKey([f], { b: 2, a: 1 }));
  });

  it('changes when a setting that alters what is kept changes', () => {
    const f = makeFile('b.mp4', 'x');
    expect(planKey([f], { keepVoice: true })).not.toBe(planKey([f], { keepVoice: false }));
  });

  it('changes when the file CONTENT changes, even at the same path', () => {
    const f = makeFile('c.mp4', 'one');
    const before = planKey([f], {});
    writeFileSync(f, 'a much longer body', 'utf8');
    expect(planKey([f], {})).not.toBe(before);
  });

  it('changes when only the mtime moves, since the bytes may have been rewritten', () => {
    const f = makeFile('d.mp4', 'same-size');
    const before = planKey([f], {});
    const future = new Date(Date.now() + 60_000);
    utimesSync(f, future, future);
    expect(planKey([f], {})).not.toBe(before);
  });

  it('distinguishes clip ORDER, because order changes the edit', () => {
    const a = makeFile('e1.mp4', 'a');
    const b = makeFile('e2.mp4', 'b');
    expect(planKey([a, b], {})).not.toBe(planKey([b, a], {}));
  });

  it('never matches when a source is missing', () => {
    const ghost = join(dir, 'gone.mp4');
    expect(planKey([ghost], {})).not.toBe(planKey([ghost], {}));
  });
});
