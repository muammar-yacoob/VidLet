import { createProgram } from './cli/index.js';
import { showHelp } from './lib/help.js';
import { fmt } from './lib/logger.js';

// Handle /? and -? as help (Windows-style)
if (process.argv.includes('/?') || process.argv.includes('-?')) {
  showHelp();
  process.exit(0);
}

const program = createProgram();

// Parse and run
program.parseAsync(process.argv).catch((error) => {
  console.error(fmt.red(`Error: ${error.message}`));
  process.exit(1);
});
