/**
 * Colored console output utilities using ANSI codes
 */

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

/** Print success message with checkmark */
export function success(message: string): void {
  console.log(`${GREEN}${CHECK}${RESET} ${message}`);
}

/** Print error message with X */
export function error(message: string): void {
  console.log(`${RED}${CROSS}${RESET} ${message}`);
}

/** Print warning message */
export function warn(message: string): void {
  console.log(`${YELLOW}${message}${RESET}`);
}

/** Print info message */
export function info(message: string): void {
  console.log(`${CYAN}${message}${RESET}`);
}

/** Print header with separator */
export function header(title: string): void {
  console.log(`${CYAN}${title}${RESET}`);
  console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
}

/** Print separator line */
export function separator(): void {
  console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
}

/** Print dim text */
export function dim(message: string): void {
  console.log(`${DIM}${message}${RESET}`);
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
