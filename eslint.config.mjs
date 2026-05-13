import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tsparser from "@typescript-eslint/parser";

export default defineConfig([
	globalIgnores([
		"**/node_modules/**",
		"main.js",
		"coverage/**",
		"docs/**",
		"vitest.config.ts",
		"esbuild.config.mjs",
		"version-bump.mjs",
	]),
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
	},
	// TypeScript already models globals; core no-undef misreports types like NodeJS.Timeout.
	{
		files: ["**/*.{ts,tsx}"],
		rules: {
			"no-undef": "off",
		},
	},
	{
		files: ["package.json"],
		rules: {
			"depend/ban-dependencies": "off",
		},
	},
	{
		files: [
			"**/*.test.ts",
			"**/__tests__/**/*.ts",
			"**/__mocks__/**/*.ts",
		],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unsafe-function-type": "off",
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"@typescript-eslint/await-thenable": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "off",
			"@typescript-eslint/no-deprecated": "off",
			"@typescript-eslint/only-throw-error": "off",
			"@typescript-eslint/unbound-method": "off",
			"@microsoft/sdl/no-inner-html": "off",
			"obsidianmd/validate-manifest": "off",
			"obsidianmd/validate-license": "off",
			"obsidianmd/hardcoded-config-path": "off",
			"import/no-extraneous-dependencies": "off",
		},
	},
	// Plugin source: keep TypeScript safety rules on so regressions surface in CI.
	// The Brickset API responses are routed through a typed `fetchJson<T>` helper
	// in `src/bricksetApi.ts`; the `cache.frontmatter` reads in `syncBackService.ts`
	// are narrowed via the `LegoSetFrontmatter` cast. Other unsafe-any sources
	// (errors in catch blocks, `JSON.parse`, `loadData`) are explicitly narrowed.
	{
		files: ["src/**/*.ts"],
		ignores: ["**/*.test.ts", "**/__tests__/**", "**/__mocks__/**"],
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"obsidianmd/ui/sentence-case": "warn",
		},
	},
]);
