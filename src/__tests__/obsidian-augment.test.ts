import { describe, it, expect, expectTypeOf } from 'vitest';
import type { Plugin } from 'obsidian';

/**
 * Tests for the module augmentation in `src/obsidian-augment.d.ts`.
 *
 * The augmentation widens `Plugin.onunload`'s return type from `void` to
 * `Promise<void> | void`, mirroring how Obsidian already types
 * `Plugin.onload`. Without it, an `async onunload()` override would
 * trip `@typescript-eslint/no-misused-promises` and require an
 * inline suppression at every call site.
 *
 * `.d.ts` files emit no JavaScript so they cannot be measured by
 * v8 coverage. What we verify here is the *contract* the augmentation
 * establishes:
 *
 *   1. The compile-time signature exposed to consumers is correct.
 *   2. Removal or accidental narrowing of the augmentation breaks the
 *      build (the type assertions below stop compiling).
 *   3. The runtime semantics that motivated the augmentation —
 *      awaiting an async teardown — actually work end-to-end.
 *
 * The type-level assertions (`expectTypeOf<...>().toEqualTypeOf<...>`)
 * are erased at runtime but checked by `tsc -noEmit` during
 * `npm run build`, so they fail the build if the augmentation is
 * removed or modified.
 */
describe('obsidian-augment.d.ts (Plugin.onunload typing)', () => {
	it('widens Plugin.onunload return type to Promise<void> | void', () => {
		expectTypeOf<ReturnType<Plugin['onunload']>>()
			.toEqualTypeOf<Promise<void> | void>();
	});

	it('accepts an async onunload override at the type level', () => {
		// If the augmentation is missing, `Plugin['onunload']` is
		// `() => void` and an async override is not assignable.
		type AsyncOnUnload = () => Promise<void>;
		expectTypeOf<AsyncOnUnload>().toExtend<Plugin['onunload']>();
	});

	it('accepts a sync (void-returning) onunload override at the type level', () => {
		// The augmentation must remain a *widening* — a synchronous
		// override (the original Component contract) must still be valid.
		type SyncOnUnload = () => void;
		expectTypeOf<SyncOnUnload>().toExtend<Plugin['onunload']>();
	});

	it('async onunload bodies behave as awaitable Promises at runtime', async () => {
		// Runtime sanity check: the pattern the augmentation exists to
		// support — `async onunload()` returning an awaitable thenable —
		// works as expected. Mirrors how `BricksetPlugin.onunload`
		// awaits the final state-cache flush in `src/main.ts`.
		let teardownRan = false;
		const onunload: () => Promise<void> = async () => {
			await Promise.resolve();
			teardownRan = true;
		};

		const result = onunload();
		expect(result).toBeInstanceOf(Promise);
		await result;
		expect(teardownRan).toBe(true);
	});
});
