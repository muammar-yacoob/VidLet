/**
 * Build-time HTML includes.
 *
 * The GUI is served as static files, so there is no templating at runtime.
 * Instead the shell page carries `<!--#include partials/x.html -->` markers on
 * their own lines, and this expands them into one file at build time.
 *
 * Markers sit at column 0 and are replaced whole: a partial keeps the exact
 * indentation it had in the assembled page, so the output is byte-for-byte
 * what a single hand-written file would be.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const INCLUDE = /^<!--#include (\S+) -->\n/gm;

/**
 * Read an HTML file and expand its includes, recursively.
 *
 * @param {string} entry Path to the shell page.
 * @returns {string} The assembled HTML.
 */
export function assembleHtml(entry) {
  const dir = dirname(entry);
  return readFileSync(entry, 'utf-8').replace(INCLUDE, (_marker, rel) =>
    assembleHtml(join(dir, rel))
  );
}
