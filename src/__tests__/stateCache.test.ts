import { describe, it, expect, beforeEach, vi } from 'vitest';
import { App } from 'obsidian';
import { StateCache, CachedState } from '../stateCache';

interface MockVault {
	getFileByPath: ReturnType<typeof vi.fn>;
	read: ReturnType<typeof vi.fn>;
	process: ReturnType<typeof vi.fn>;
	create: ReturnType<typeof vi.fn>;
}

interface MockApp {
	vault: MockVault;
}

function createMockApp(): MockApp {
	return {
		vault: {
			getFileByPath: vi.fn().mockReturnValue(null),
			read: vi.fn().mockResolvedValue('{}'),
			process: vi.fn().mockImplementation(async (_f: unknown, fn: (d: string) => string) => fn('{}')),
			create: vi.fn().mockResolvedValue(undefined)
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
			app.vault.getFileByPath.mockReturnValue(null);
			await cache.load();
			expect(cache.size()).toBe(0);
			expect(app.vault.read).not.toHaveBeenCalled();
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
			const stubFile = { path: '.obsidian/plugins/brickset/state-cache.json' };
			app.vault.getFileByPath.mockReturnValue(stubFile);
			app.vault.read.mockResolvedValue(JSON.stringify(mockData));

			await cache.load();

			expect(cache.size()).toBe(1);
			const state = cache.get('LEGO Sets/Friends/test.md');
			expect(state?.setID).toBe(12345);
			expect(state?.owned).toBe(true);
			expect(state?.qtyOwned).toBe(2);
			expect(app.vault.read).toHaveBeenCalledWith(stubFile);
		});

		it('should handle corrupt cache file gracefully', async () => {
			const stubFile = { path: '.obsidian/plugins/brickset/state-cache.json' };
			app.vault.getFileByPath.mockReturnValue(stubFile);
			app.vault.read.mockResolvedValue('invalid json {{{');

			await cache.load();

			expect(cache.size()).toBe(0);
		});

		// Exercises the `else { this.cache = new Map(); }` branch on
		// stateCache.ts:45 — JSON.parse succeeds but produces a non-object
		// value (number, string, null), so the `parsed && typeof parsed ===
		// 'object'` guard is false and the cache is reset to empty without
		// throwing.
		it('should fall back to empty cache when parsed JSON is not an object (null)', async () => {
			const stubFile = { path: '.obsidian/plugins/brickset/state-cache.json' };
			app.vault.getFileByPath.mockReturnValue(stubFile);
			app.vault.read.mockResolvedValue('null');

			await cache.load();

			expect(cache.size()).toBe(0);
		});

		it('should fall back to empty cache when parsed JSON is a primitive (number)', async () => {
			const stubFile = { path: '.obsidian/plugins/brickset/state-cache.json' };
			app.vault.getFileByPath.mockReturnValue(stubFile);
			app.vault.read.mockResolvedValue('42');

			await cache.load();

			expect(cache.size()).toBe(0);
		});
	});

	describe('save()', () => {
		it('should not write to disk if cache is not dirty', async () => {
			await cache.save();
			expect(app.vault.create).not.toHaveBeenCalled();
			expect(app.vault.process).not.toHaveBeenCalled();
		});

		it('should create cache file when dirty and no file exists yet', async () => {
			app.vault.getFileByPath.mockReturnValue(null);
			cache.set('test.md', {
				setID: 1,
				owned: false,
				wanted: false,
				lastModified: Date.now()
			});

			await cache.save();

			expect(app.vault.create).toHaveBeenCalledOnce();
			expect(app.vault.process).not.toHaveBeenCalled();
			const [path, content] = app.vault.create.mock.calls[0];
			expect(path).toContain('state-cache.json');
			const parsed = JSON.parse(content);
			expect(parsed['test.md'].setID).toBe(1);
		});

		it('should process existing cache file when dirty', async () => {
			const stubFile = { path: '.obsidian/plugins/brickset/state-cache.json' };
			app.vault.getFileByPath.mockReturnValue(stubFile);
			cache.set('test.md', {
				setID: 1,
				owned: false,
				wanted: false,
				lastModified: Date.now()
			});

			await cache.save();

			expect(app.vault.process).toHaveBeenCalledOnce();
			expect(app.vault.process).toHaveBeenCalledWith(stubFile, expect.any(Function));
			expect(app.vault.create).not.toHaveBeenCalled();
			const [, fn] = app.vault.process.mock.calls[0] as [unknown, (d: string) => string];
			const parsed = JSON.parse(fn('ignored'));
			expect(parsed['test.md'].setID).toBe(1);
		});

		it('should not write again if already saved', async () => {
			app.vault.getFileByPath.mockReturnValue(null);
			cache.set('test.md', { setID: 1, owned: false, wanted: false, lastModified: 0 });
			await cache.save();
			await cache.save(); // Second save should be skipped

			expect(app.vault.create).toHaveBeenCalledOnce();
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

		it('should mark cache as dirty when deleting existing entry', async () => {
			app.vault.getFileByPath.mockReturnValue(null);
			cache.set('test.md', { setID: 1, owned: false, wanted: false, lastModified: 0 });
			cache.delete('test.md');
			await cache.save();
			expect(app.vault.create).toHaveBeenCalled();
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
	it('should log error and not throw when create fails', async () => {
		const app = {
			vault: {
				getFileByPath: vi.fn().mockReturnValue(null),
				read: vi.fn(),
				process: vi.fn(),
				create: vi.fn().mockRejectedValue(new Error('Disk full'))
			}
		};
		const cache = new StateCache(app as unknown as App, '.obsidian/plugins/brickset');
		cache.set('test.md', { setID: 1, owned: false, wanted: false, lastModified: 0 });

		await expect(cache.save()).resolves.toBeUndefined();
	});
});

describe('StateCache - delete() branch (line 85)', () => {
	it('should not set isDirty when deleting a non-existent key', async () => {
		const app = {
			vault: {
				getFileByPath: vi.fn().mockReturnValue(null),
				read: vi.fn().mockResolvedValue('{}'),
				process: vi.fn(),
				create: vi.fn().mockResolvedValue(undefined)
			}
		};
		const cache = new StateCache(app as unknown as App, '.obsidian/plugins/brickset');
		await cache.load();

		cache.delete('non-existent-key.md');

		await cache.save();
		expect(app.vault.create).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
	});
});
