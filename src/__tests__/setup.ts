/**
 * Test setup: provide the Obsidian-injected `activeWindow` / `activeDocument`
 * globals in the node test environment. In Obsidian's runtime these proxy to
 * the currently focused popout/main window; in node we just point them at
 * `globalThis` so timer calls like `activeWindow.setTimeout(...)` resolve to
 * the standard implementations.
 */
const globalScope = globalThis as typeof globalThis & {
	activeWindow?: typeof globalThis;
	activeDocument?: unknown;
};

globalScope.activeWindow = globalThis;
globalScope.activeDocument = globalScope.activeDocument ?? {};
