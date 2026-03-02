import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncBackService } from '../syncBackService';
import { StateCache, CachedState } from '../stateCache';
import { BricksetApiService } from '../bricksetApi';
import { DEFAULT_SETTINGS } from '../types';

// Mock obsidian
vi.mock('obsidian', () => ({
	App: class App {
		vault = {};
		metadataCache = {};
		fileManager = {};
	},
	TFile: class {
		constructor(public path: string, public basename: string = path.split('/').pop()?.replace('.md', '') || '') {}
	},
	Notice: class { constructor(public message: string) {} },
	normalizePath: (p: string) => p,
	requestUrl: vi.fn().mockResolvedValue({
		status: 200,
		text: '{"status":"success"}',
		json: { status: 'success' }
	})
}));

/**
 * Create a testable version of SyncBackService that exposes private methods
 */
class TestableSyncBackService extends SyncBackService {
	public testDetectChanges(file: any, frontmatter: any) {
		return (this as any).detectChanges(file, frontmatter);
	}
}

function createMockApp() {
	return {
		vault: {
			adapter: {
				exists: vi.fn().mockResolvedValue(false),
				read: vi.fn().mockResolvedValue('{}'),
				write: vi.fn().mockResolvedValue(undefined)
			},
			getAbstractFileByPath: vi.fn().mockReturnValue(null)
		},
		metadataCache: {
			on: vi.fn().mockReturnValue({ id: 'mock-ref' }),
			off: vi.fn(),
			offref: vi.fn(),
			getFileCache: vi.fn().mockReturnValue(null)
		},
		fileManager: {
			processFrontMatter: vi.fn().mockResolvedValue(undefined)
		}
	} as any;
}

function createMockFile(path: string) {
	return {
		path,
		basename: path.split('/').pop()?.replace('.md', '') || ''
	} as any;
}

type MockApp = ReturnType<typeof createMockApp>;

function setupCachedState(
	stateCache: StateCache,
	filePath: string,
	overrides: Partial<CachedState> = {}
): void {
	stateCache.set(filePath, {
		setID: 1,
		owned: false,
		wanted: false,
		qtyOwned: 0,
		lastModified: 0,
		...overrides
	});
}

describe('SyncBackService - detectChanges()', () => {
	let app: MockApp;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, {
			...DEFAULT_SETTINGS,
			enableBidirectionalSync: true,
			syncDebounceMs: 100,
			showSyncNotifications: false
		});
	});

	describe('First-time file detection', () => {
		it('should return null and cache state when file is seen for the first time', () => {
			const file = createMockFile('LEGO Sets/Friends/test.md');
			const frontmatter = { setID: 1, owned: true, wanted: false, qtyOwned: 1 };

			const result = service.testDetectChanges(file, frontmatter);

			expect(result).toBeNull();
			// State should be cached
			expect(stateCache.get(file.path)).toBeDefined();
			expect(stateCache.get(file.path)?.owned).toBe(true);
		});
	});

	describe('No changes', () => {
		it('should return null when nothing changed', () => {
			const file = createMockFile('test.md');
			const frontmatter = { setID: 1, owned: true, wanted: false, qtyOwned: 2, userRating: 4 };

			// First call - caches state
			service.testDetectChanges(file, frontmatter);

			// Second call - same state
			const result = service.testDetectChanges(file, frontmatter);
			expect(result).toBeNull();
		});
	});

	describe('owned flag changes', () => {
		it('should detect owned changing from false to true', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path);

			const result = service.testDetectChanges(file, { setID: 1, owned: true, wanted: false, qtyOwned: 0 });

			expect(result).not.toBeNull();
			expect(result?.changes.owned).toBe(true);
		});

		it('should detect owned changing from true to false', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path, { owned: true, qtyOwned: 3 });

			const result = service.testDetectChanges(file, { setID: 1, owned: false, wanted: false, qtyOwned: 3 });

			expect(result).not.toBeNull();
			expect(result?.changes.owned).toBe(false);
		});
	});

	describe('owned/qtyOwned auto-correction rules', () => {
		it.each([
			{
				label: 'owned=false auto-sets qtyOwned to 0',
				cached:   { owned: true,  qtyOwned: 3 },
				fm:       { owned: false, qtyOwned: 3 },
				expected: { owned: false, qtyOwned: 0 }
			},
			{
				label: 'qtyOwned>0 auto-sets owned to true',
				cached:   { owned: false, qtyOwned: 0 },
				fm:       { owned: false, qtyOwned: 3 },
				expected: { owned: true,  qtyOwned: 3 }
			},
			{
				label: 'qtyOwned=0 auto-sets owned to false',
				cached:   { owned: true,  qtyOwned: 3 },
				fm:       { owned: true,  qtyOwned: 0 },
				expected: { owned: false, qtyOwned: 0 }
			},
		])('$label', ({ cached, fm, expected }) => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path, cached);

			const result = service.testDetectChanges(file, { setID: 1, wanted: false, ...fm });

			expect(result?.changes.owned).toBe(expected.owned);
			expect(result?.changes.qtyOwned).toBe(expected.qtyOwned);
		});
	});

	describe('qtyOwned changes', () => {
		it('should detect qtyOwned increasing', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path, { owned: true, qtyOwned: 1 });

			const result = service.testDetectChanges(file, { setID: 1, owned: true, wanted: false, qtyOwned: 5 });

			expect(result).not.toBeNull();
			expect(result?.changes.qtyOwned).toBe(5);
		});
	});

	describe('wanted flag changes', () => {
		it('should detect wanted changing from false to true', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path);

			const result = service.testDetectChanges(file, { setID: 1, owned: false, wanted: true });

			expect(result).not.toBeNull();
			expect(result?.changes.wanted).toBe(true);
		});

		it('should detect wanted changing from true to false', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path, { wanted: true });

			const result = service.testDetectChanges(file, { setID: 1, owned: false, wanted: false });

			expect(result).not.toBeNull();
			expect(result?.changes.wanted).toBe(false);
		});
	});

	describe('userRating changes', () => {
		it('should detect rating change', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path, { userRating: 3 });

			const result = service.testDetectChanges(file, { setID: 1, owned: false, wanted: false, userRating: 5 });

			expect(result).not.toBeNull();
			expect(result?.changes.userRating).toBe(5);
		});

		it('should detect rating being set for the first time', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path);

			const result = service.testDetectChanges(file, { setID: 1, owned: false, wanted: false, userRating: 4 });

			expect(result).not.toBeNull();
			expect(result?.changes.userRating).toBe(4);
		});
	});

	describe('Multiple simultaneous changes', () => {
		it('should detect multiple changes at once', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path);

			const result = service.testDetectChanges(file, { setID: 1, owned: true, wanted: true, qtyOwned: 2 });

			expect(result).not.toBeNull();
			expect(result?.changes.owned).toBe(true);
			expect(result?.changes.wanted).toBe(true);
			expect(result?.changes.qtyOwned).toBe(2);
		});
	});

	describe('setID in result', () => {
		it('should include setID from frontmatter in result', () => {
			const file = createMockFile('test.md');
			setupCachedState(stateCache, file.path, { setID: 23351 });

			const result = service.testDetectChanges(file, { setID: 23351, owned: true, wanted: false });

			expect(result?.setID).toBe(23351);
		});
	});
});

describe('SyncBackService - startWatching/stopWatching', () => {
	let app: MockApp;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: SyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new SyncBackService(app, apiService, stateCache, {
			...DEFAULT_SETTINGS,
			enableBidirectionalSync: true,
			syncDebounceMs: 100,
			showSyncNotifications: false
		});
	});

	it('should register metadata change listener when startWatching is called', () => {
		service.startWatching();
		expect(app.metadataCache.on).toHaveBeenCalledWith('changed', expect.any(Function));
	});

	it('should not register listener twice if already watching', () => {
		service.startWatching();
		service.startWatching(); // Second call should be ignored
		expect(app.metadataCache.on).toHaveBeenCalledOnce();
	});

	it('should unregister listener when stopWatching is called', () => {
		service.startWatching();
		service.stopWatching();
		expect(app.metadataCache.offref).toHaveBeenCalled();
	});
});
