// Align Obsidian's Plugin.onunload type with its runtime contract.
//
// The Obsidian plugin loader awaits a thenable returned from onunload —
// the same way it does for onload, which the published types already
// declare as `Promise<void> | void` (see obsidian.d.ts: `Plugin.onload`).
// The Component base class, however, still declares `onunload(): void`,
// so an `async onunload()` override trips
// `@typescript-eslint/no-misused-promises` despite being the documented
// pattern used widely across community plugins.
//
// This augmentation makes Plugin.onunload symmetric with Plugin.onload,
// so we can `await` final teardown work (e.g. flushing the state cache)
// without suppressing lint rules at the call site.
import 'obsidian';

declare module 'obsidian' {
	interface Plugin {
		onunload(): Promise<void> | void;
	}
}
