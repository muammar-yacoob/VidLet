import { createProgram } from './cli/index.js';
import { fmt } from './lib/logger.js';

const program = createProgram();

// Parse and run
program.parseAsync(process.argv).catch((error) => {
	console.error(fmt.red(`Error: ${error.message}`));
	process.exit(1);
});
