import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
		globals: true,
		environment: 'node',
		globalSetup: './src/test-support/setup.ts',
		exclude: ['**/node_modules', '**/dist', '.idea', '.git', '.cache', '**/lib', '**/out'],
	},
	build: {
		lib: {
			entry: resolve( import.meta.dirname, 'src/index.ts' ),
			name: 'entropic-bond-appwrite',
			fileName: 'entropic-bond-appwrite'
		},
		sourcemap: true,
		outDir: 'lib',
		rollupOptions: {
			external: [
				'appwrite',
				'node-appwrite',
				'entropic-bond',
			],
			output: {
				globals: {
					'appwrite': 'appwrite',
					'node-appwrite': 'Appwrite',
					'entropic-bond': 'EntropicBond',
				}
			}
		}
	}
})