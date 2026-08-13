import { readFileSync } from 'node:fs';

/**
 * The package version, read from package.json the same way mcp.js does.
 *
 * The path is relative to the BUILD OUTPUT, not this file: tsup bundles every
 * entry to dist/*.js, so `../package.json` is the package root at runtime.
 * Hard-coding the version here instead drifts the moment package.json is
 * bumped, which is how `vidlet --version` reported 1.0.0 from a 1.2.0 tarball.
 */
export function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    // Running from an unbundled context (tsx, vitest) - not worth failing over.
    return '0.0.0';
  }
}
