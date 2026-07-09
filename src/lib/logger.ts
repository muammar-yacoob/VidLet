/**
 * Colored console output utilities using ANSI codes
 * Also writes to a persistent log file for debugging
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ANSI color codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// Status symbols
const CHECK = '\u2713';
const CROSS = '\u2717';

// Log file path
const LOG_DIR = join(homedir(), '.vidlet');
const LOG_FILE = join(LOG_DIR, 'vidlet.log');

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Ignore if already exists
}

/** Strip ANSI codes from string */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the ESC control char is required to match ANSI color codes
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Write to log file with timestamp */
function writeToLog(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    const cleanMessage = stripAnsi(message);
    appendFileSync(LOG_FILE, `[${timestamp}] ${cleanMessage}\n`);
  } catch {
    // Silently ignore log write errors
  }
}

/** Get log file path */
export function getLogPath(): string {
  return LOG_FILE;
}

/** Print success message with checkmark */
export function success(message: string): void {
  const msg = `${GREEN}${CHECK}${RESET} ${message}`;
  console.log(msg);
  writeToLog(`[SUCCESS] ${message}`);
}

/** Print error message with X */
export function error(message: string): void {
  const msg = `${RED}${CROSS}${RESET} ${message}`;
  console.log(msg);
  writeToLog(`[ERROR] ${message}`);
}

/** Print warning message */
export function warn(message: string): void {
  const msg = `${YELLOW}${message}${RESET}`;
  console.log(msg);
  writeToLog(`[WARN] ${message}`);
}

/** Print info message */
export function info(message: string): void {
  const msg = `${CYAN}${message}${RESET}`;
  console.log(msg);
  writeToLog(`[INFO] ${message}`);
}

/** Print header with separator */
export function header(title: string): void {
  console.log(`${CYAN}${title}${RESET}`);
  console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
  writeToLog(`\n=== ${title} ===`);
}

/** Print separator line */
export function separator(): void {
  console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
}

/** Print dim text */
export function dim(message: string): void {
  const msg = `${DIM}${message}${RESET}`;
  console.log(msg);
  writeToLog(message);
}

/** Log raw message to file only (for debugging) */
export function logToFile(message: string): void {
  writeToLog(message);
}

/** Create a CLI spinner for long-running operations */
export function createSpinner(message: string) {
  const frames = [
    '\u28CB',
    '\u28D9',
    '\u28F9',
    '\u28F8',
    '\u28FC',
    '\u28F4',
    '\u28E6',
    '\u28E7',
    '\u28C7',
    '\u28CF',
  ];
  let text = message;
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(
      `\r${CYAN}${frames[i++ % frames.length]}${RESET} ${DIM}${text}${RESET}\x1b[K`
    );
  }, 80);

  return {
    update(msg: string) {
      text = msg;
    },
    stop(finalMessage?: string) {
      clearInterval(id);
      process.stdout.write('\r\x1b[2K');
      if (finalMessage) {
        console.log(finalMessage);
      }
    },
  };
}

// Inline formatters for building strings
export const fmt = {
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  white: (s: string) => `${WHITE}${s}${RESET}`,
  gray: (s: string) => `${GRAY}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
};
