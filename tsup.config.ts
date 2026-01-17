import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/cli.ts'],
	format: ['esm'],
	dts: false,
	splitting: false,
	sourcemap: true,
	clean: true,
	outDir: 'dist',
	treeshake: true,
	target: 'node18',
	banner: {
		js: '#!/usr/bin/env node',
	},
	onSuccess: async () => {
		// Copy GUI assets
		cpSync('src/gui', 'dist/gui', { recursive: true });

		// Copy icons
		cpSync('src/icons', 'dist/icons', { recursive: true });

		// Copy launcher script
		cpSync('src/launcher.vbs', 'dist/launcher.vbs');

		console.log('Assets copied to dist/');
	},
});
