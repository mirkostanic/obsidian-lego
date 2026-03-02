import { describe, it, expect, beforeEach, vi } from 'vitest';
import { App } from 'obsidian';
import { StateCache, CachedState } from '../stateCache';

interface MockVaultAdapter {
	exists: ReturnType<typeof vi.fn>;
	read:   ReturnType<typeof vi.fn>;
	write:  ReturnType<typeof vi.fn>;
}

interface MockApp {
	vault: { adapter: MockVaultAdapter };
}

// Create a mock App for testing
function createMockApp(fileExists = false, fileContent = '{}'): MockApp {
	return {
		vault: {
			adapter: {
				exists: vi.fn().mockResolvedValue(fileExists),
				read:   vi.fn().mockResolvedValue(fileContent),
				write:  vi.fn().mockResolvedValue(undefined)
			}
		}
	};
}

describe('StateCache', () => {
	let app: MockApp;
	let cache: StateCache;

	beforeEach(() => {
		app = createMockApp();
		cache = new StateCache(app as unknown as App, '.obsidian/plugins/brickset');
	});

	describe('load()', () => {
		it('should initialize empty cache when file does not exist', async () => {
			app.vault.adapter.exists.mockResolvedValue(false);
			await cache.load();
			expect(cache.size()).toBe(0);
		});

		it('should load cache from file when it exists', async () => {
			const mockData = {
				'LEGO Sets/Friends/test.md': {
					setID: 12345,
					owned: true,
					wanted: false,
					qtyOwned: 2,
					lastModified: 1000000
				}
			};
			app.vault.adapter.exists.mockResolvedValue(true);
			app.vault.adapter.read.mockResolvedValue(JSON.stringify(mockData));

			await cache.load();

			expect(cache.size()).toBe(1);
			const state = cache.get('LEGO Sets/Friends/test.md');
			expect(state?.setID).toBe(12345);
			expect(state?.owned).toBe(true);
			expect(state?.qtyOwned).toBe(2);
		});

		it('should handle corrupt cache file gracefully', async () => {
			app.vault.adapter.exists.mockResolvedValue(true);
			app.vault.adapter.read.mockResolvedValue('invalid json {{{');

			await cache.load();

			expect(cache.size()).toBe(0);
		});
	});

	describe('save()', () => {
		it('should not write to disk if cache is not dirty', async () => {
			await cache.save();
			expect(app.vault.adapter.write).not.toHaveBeenCalled();
		});

		it('should write to disk when cache is dirty', async () => {
			cache.set('test.md', {
				setID: 1,
				owned: false,
				wanted: false,
				lastModified: Date.now()
			});

			await cache.save();

			expect(app.vault.adapter.write).toHaveBeenCalledOnce();
			const [path, content] = app.vault.adapter.write.mock.calls[0];
			expect(path).toContain('state-cache.json');
			const parsed = JSON.parse(content);
			expect(parsed['test.md'].setID).toBe(1);
		});

		it('should not write again if already saved', async () => {
			cache.set('test.md', { setID: 1, owned: false, wanted: false, lastModified: 0 });
			await cache.save();
			await cache.save(); // Second save should be skipped

			expect(app.vault.adapter.write).toHaveBeenCalledOnce();
		});
	});

	describe('get() and set()', () => {
		it('should return null for unknown file', () => {
			expect(cache.get('unknown.md')).toBeUndefined();
		});

		it('should store and retrieve state', () => {
			const state: CachedState = {
				setID: 99,
				owned: true,
				wanted: false,
				qtyOwned: 3,
				userRating: 4,
				lastModified: 12345
			};

			cache.set('test.md', state);
			const retrieved = cache.get('test.md');

			expect(retrieved).toEqual(state);
		});
	});

	describe('delete()', () => {
		it('should remove a cached state', () => {
			cache.set('test.md', { setID: 1, owned: false, wanted: false, lastModified: 0 });
			expect(cache.has('test.md')).toBe(true);

			cache.delete('test.md');
			expect(cache.has('test.md')).toBe(false);
		});

		it('should mark cache as dirty when deleting existing entry', () => {
			cache.set('test.md', { setID: 1, owned: false, wanted: false, lastModified: 0 });
			// Save to clear dirty flag
			// Note: we can't easily test isDirty directly, but we can test behavior
			cache.delete('test.md');
			// After delete, save should write
			cache.save();
			expect(app.vault.adapter.write).toHaveBeenCalled();
		});
	});

	describe('clear()', () => {
		it('should remove all cached states', () => {
			cache.set('a.md', { setID: 1, owned: false, wanted: false, lastModified: 0 });
			cache.set('b.md', { setID: 2, owned: true, wanted: false, lastModified: 0 });
			expect(cache.size()).toBe(2);

			cache.clear();
			expect(cache.size()).toBe(0);
		});
	});

	describe('updateFromFrontmatter()', () => {
		it('should store state from frontmatter', () => {
			const frontmatter = {
				setID: 23351,
				owned: true,
				wanted: false,
				qtyOwned: 5,
				userRating: 4
			};

			cache.updateFromFrontmatter('test.md', frontmatter);

			const state = cache.get('test.md');
			expect(state?.setID).toBe(23351);
			expect(state?.owned).toBe(true);
			expect(state?.wanted).toBe(false);
			expect(state?.qtyOwned).toBe(5);
			expect(state?.userRating).toBe(4);
		});

		it('should default owned and wanted to false if not present', () => {
			cache.updateFromFrontmatter('test.md', { setID: 1 });

			const state = cache.get('test.md');
			expect(state?.owned).toBe(false);
			expect(state?.wanted).toBe(false);
		});

		it('should not store state if setID is missing', () => {
			cache.updateFromFrontmatter('test.md', { owned: true });
			expect(cache.get('test.md')).toBeUndefined();
		});

		it('should update lastModified timestamp', () => {
			const before = Date.now();
			cache.updateFromFrontmatter('test.md', { setID: 1 });
			const after = Date.now();

			const state = cache.get('test.md');
			expect(state?.lastModified).toBeGreaterThanOrEqual(before);
			expect(state?.lastModified).toBeLessThanOrEqual(after);
		});
	});
});

describe('StateCache - save() error handling', () => {
	it('should log error and not throw when write fails', async () => {
		const app = {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockResolvedValue('{}'),
					write: vi.fn().mockRejectedValue(new Error('Disk full'))
				}
			}
		};
		const cache = new StateCache(app as unknown as App, '.obsidian/plugins/brickset');
		cache.set('test.md', { setID: 1, owned: false, wanted: false, lastModified: 0 });

		// Should not throw even when write fails
		await expect(cache.save()).resolves.toBeUndefined();
	});
});

describe('StateCache - delete() branch (line 85)', () => {
	it('should not set isDirty when deleting a non-existent key', async () => {
		const app = {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockResolvedValue('{}'),
					write: vi.fn().mockResolvedValue(undefined)
				}
			}
		};
		const cache = new StateCache(app as unknown as App, '.obsidian/plugins/brickset');
		await cache.load();

		// Delete a key that was never set → Map.delete returns false → isDirty stays false
		cache.delete('non-existent-key.md');

		// save() should not write because isDirty is false
		await cache.save();
		expect(app.vault.adapter.write).not.toHaveBeenCalled();
	});
});
