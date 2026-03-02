import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		pool: 'forks',
		include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: [
				'src/__mocks__/**',
				'src/**/*.test.ts',
				'src/**/*.spec.ts',
				'src/main.ts'  // Plugin entry point - no test
			]
		}
	},
	resolve: {
		alias: {
			// Map 'obsidian' imports the mock
			'obsidian': resolve(__dirname, 'src/__mocks__/obsidian.ts')
		}
	}
});
