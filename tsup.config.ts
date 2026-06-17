import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

const isWatch = process.argv.includes('--watch');

export default defineConfig({
	entry: ['src/cli.ts'],
	format: ['esm'],
	dts: false,
	splitting: false,
	sourcemap: true,
	clean: !isWatch,
	outDir: 'dist',
	treeshake: !isWatch,
	target: 'node18',
	silent: !isWatch,
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

		// Copy audio models (RNNoise)
		cpSync('src/models', 'dist/models', { recursive: true });

		// Copy lottie-web light build for HTA animation preview
		cpSync('node_modules/lottie-web/build/player/lottie_light.min.js', 'dist/gui/lottie_light.min.js');
	},
});
