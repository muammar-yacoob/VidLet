import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearServedResources,
  listServedResources,
  readServedResource,
  registerServedFile,
  setResourceListChangedNotifier,
} from './resources.js';

let dir: string;

beforeEach(() => {
  clearServedResources();
  setResourceListChangedNotifier(() => {});
  dir = mkdtempSync(join(tmpdir(), 'vidlet-res-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeFile(name: string, contents: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe('served resource registry', () => {
  it('serves a registered binary file as a base64 blob', () => {
    const bytes = Buffer.from([0, 1, 2, 253, 254, 255]);
    const uri = registerServedFile(makeFile('short.mp4', bytes));

    const { contents } = readServedResource(uri);
    expect(contents[0].mimeType).toBe('video/mp4');
    expect(contents[0].blob).toBe(bytes.toString('base64'));
    expect(contents[0].text).toBeUndefined();
  });

  it('serves a .vidlet project as text, not a blob', () => {
    const uri = registerServedFile(makeFile('edit.vidlet', '{"version":1}'));

    const { contents } = readServedResource(uri);
    expect(contents[0].text).toBe('{"version":1}');
    expect(contents[0].blob).toBeUndefined();
  });

  // The whole point of the registry: resources/read must not be a general
  // file-read primitive for any client that can name a path.
  it('refuses a path it never produced', () => {
    registerServedFile(makeFile('mine.mp4', 'x'));
    const stranger = pathToFileURL('/etc/passwd').href;

    expect(() => readServedResource(stranger)).toThrow(/only serves files it produced/);
  });

  it('reports a registered file that has since been deleted', () => {
    const path = makeFile('gone.mp4', 'x');
    const uri = registerServedFile(path);
    rmSync(path);

    expect(() => readServedResource(uri)).toThrow(/no longer exists/);
    expect(listServedResources().resources).toHaveLength(0);
  });

  it('lists newest first and does not duplicate a re-registered file', () => {
    const first = registerServedFile(makeFile('a.mp4', 'a'));
    const second = registerServedFile(makeFile('b.mp4', 'b'));
    registerServedFile(makeFile('a.mp4', 'a'));

    const { resources } = listServedResources();
    expect(resources.map((r) => r.uri)).toEqual([first, second]);
    expect(resources[0].size).toBe(1);
  });

  it('notifies only when a file is newly registered', () => {
    let calls = 0;
    setResourceListChangedNotifier(() => {
      calls += 1;
    });
    const path = makeFile('a.mp4', 'a');

    registerServedFile(path);
    registerServedFile(path);

    expect(calls).toBe(1);
  });
});
