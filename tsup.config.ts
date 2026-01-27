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
	silent: true,
	banner: {
		js: '#!/usr/bin/env node',
	},
	onSuccess: async () => {
		// Copy GUI assets
		cpSync('src/gui', 'dist/gui', { recursive: true });

		// Copy icons
		cpSync('src/icons', 'dist/icons', { recursive: true });

		// Copy icon and logo to gui folder for HTA
		cpSync('src/icons/tv.ico', 'dist/gui/tv.ico');
		cpSync('src/icons/tv.png', 'dist/gui/tv.png');

		// Copy animations to gui folder for HTA
		cpSync('src/animations', 'dist/gui/animations', { recursive: true });

		// Copy launcher script
		cpSync('src/launcher.vbs', 'dist/launcher.vbs');
	},
});
