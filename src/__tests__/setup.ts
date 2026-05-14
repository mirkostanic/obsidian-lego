/**
 * Test setup: provide Obsidian-like globals in the Node test environment.
 * `activeWindow` / `activeDocument` proxy to the focused window in Obsidian;
 * plugin code uses `window` for timers (community-review guideline). Here all
 * of these point at `globalThis` so timer APIs resolve to Node's builtins.
 */
const globalScope = globalThis as typeof globalThis & {
	activeWindow?: typeof globalThis;
	activeDocument?: unknown;
	window?: Window & typeof globalThis;
};

globalScope.activeWindow = globalThis;
globalScope.window = globalThis as unknown as Window & typeof globalThis;
globalScope.activeDocument = globalScope.activeDocument ?? {};
