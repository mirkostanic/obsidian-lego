import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SyncBackService } from '../syncBackService';
import { StateCache } from '../stateCache';
import { BricksetApiService } from '../bricksetApi';
import { DEFAULT_SETTINGS } from '../types';

// Mock obsidian with requestUrl support
vi.mock('obsidian', async (importOriginal) => {
	const original = await importOriginal() as any;
	return {
		...original,
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
	};
});

/**
 * Expose private methods for testing
 */
class TestableSyncBackService extends SyncBackService {
	public testHandleFileChange(file: any): Promise<void> {
		return (this as any).handleFileChange(file);
	}

	public testSyncToApi(change: any): Promise<void> {
		return (this as any).syncToApi(change);
	}

	public testProcessQueue(): Promise<void> {
		return (this as any).processQueue();
	}

	public testScheduleProcessing(): void {
		return (this as any).scheduleProcessing();
	}

	public getChangeQueue(): Map<string, any> {
		return (this as any).changeQueue;
	}

	public setIsProcessing(val: boolean): void {
		(this as any).isProcessing = val;
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
			processFrontMatter: vi.fn().mockImplementation(async (_file: any, fn: (fm: any) => void) => {
				fn({});
			})
		}
	} as any;
}

function createMockFile(path: string) {
	return {
		path,
		basename: path.split('/').pop()?.replace('.md', '') || ''
	} as any;
}

function makeSettings(overrides = {}) {
	return {
		...DEFAULT_SETTINGS,
		enableBidirectionalSync: true,
		syncDebounceMs: 50,
		showSyncNotifications: false,
		...overrides
	};
}

describe('SyncBackService - handleFileChange()', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, makeSettings());
		vi.clearAllMocks();
	});

	afterEach(() => {
		service.stopWatching();
	});

	it('should ignore files that are not LEGO set notes (no frontmatter)', async () => {
		const file = createMockFile('some-random-note.md');
		app.metadataCache.getFileCache.mockReturnValue(null);

		await service.testHandleFileChange(file);

		// No changes queued
		expect(service.getChangeQueue().size).toBe(0);
	});

	it('should ignore files without lego+set tags', async () => {
		const file = createMockFile('some-note.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['other-tag'], setID: 123 }
		});

		await service.testHandleFileChange(file);

		expect(service.getChangeQueue().size).toBe(0);
	});

	it('should ignore files without setID', async () => {
		const file = createMockFile('lego-note.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], owned: true }
			// No setID
		});

		await service.testHandleFileChange(file);

		expect(service.getChangeQueue().size).toBe(0);
	});

	it('should ignore files with non-numeric setID', async () => {
		const file = createMockFile('lego-note.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 'not-a-number', owned: true }
		});

		await service.testHandleFileChange(file);

		expect(service.getChangeQueue().size).toBe(0);
	});

	it('should cache state and not queue change for first-time file', async () => {
		const file = createMockFile('LEGO Sets/Star Wars/75192/75192 - Millennium Falcon.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 23351, owned: true, wanted: false, qtyOwned: 1 }
		});

		await service.testHandleFileChange(file);

		// No change queued (first time = cache only)
		expect(service.getChangeQueue().size).toBe(0);
		// State should be cached
		expect(stateCache.get(file.path)).toBeDefined();
	});

	it('should queue change when owned flag changes', async () => {
		const file = createMockFile('LEGO Sets/Star Wars/75192/75192 - Millennium Falcon.md');

		// Pre-populate cache with owned=false
		stateCache.set(file.path, { setID: 23351, owned: false, wanted: false, qtyOwned: 0, lastModified: 0 });

		// File now has owned=true
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 23351, owned: true, wanted: false, qtyOwned: 0 }
		});

		await service.testHandleFileChange(file);

		expect(service.getChangeQueue().size).toBe(1);
		const change = service.getChangeQueue().get(file.path);
		expect(change?.changes.owned).toBe(true);
		expect(change?.setID).toBe(23351);
	});

	it('should update cache and not queue when no changes detected', async () => {
		const file = createMockFile('LEGO Sets/Star Wars/75192/75192 - Millennium Falcon.md');

		// Pre-populate cache with same state
		stateCache.set(file.path, { setID: 23351, owned: true, wanted: false, qtyOwned: 2, lastModified: 0 });

		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 23351, owned: true, wanted: false, qtyOwned: 2 }
		});

		await service.testHandleFileChange(file);

		expect(service.getChangeQueue().size).toBe(0);
	});

	it('should overwrite previous queued change for same file', async () => {
		const file = createMockFile('LEGO Sets/Star Wars/75192/75192 - Millennium Falcon.md');

		stateCache.set(file.path, { setID: 23351, owned: false, wanted: false, qtyOwned: 0, lastModified: 0 });

		// First change: owned=true
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 23351, owned: true, wanted: false, qtyOwned: 0 }
		});
		await service.testHandleFileChange(file);

		// Update cache to reflect first change
		stateCache.set(file.path, { setID: 23351, owned: true, wanted: false, qtyOwned: 0, lastModified: 0 });

		// Second change: also wanted=true
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 23351, owned: true, wanted: true, qtyOwned: 0 }
		});
		await service.testHandleFileChange(file);

		// Still only one entry in queue (overwritten)
		expect(service.getChangeQueue().size).toBe(1);
		const change = service.getChangeQueue().get(file.path);
		expect(change?.changes.wanted).toBe(true);
	});
});

describe('SyncBackService - syncToApi()', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, makeSettings());
		vi.clearAllMocks();
	});

	it('should call apiService.setUserFlags with correct flags', async () => {
		const setUserFlagsSpy = vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('LEGO Sets/Star Wars/75192/75192 - Millennium Falcon.md');

		// Set up cache so updateFromFrontmatter works
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 23351, owned: true, wanted: false, qtyOwned: 2 }
		});

		const change = {
			file,
			setID: 23351,
			changes: { owned: true, wanted: false, qtyOwned: 2 },
			timestamp: Date.now()
		};

		await service.testSyncToApi(change);

		expect(setUserFlagsSpy).toHaveBeenCalledOnce();
		expect(setUserFlagsSpy).toHaveBeenCalledWith(23351, {
			own: true,
			want: false,
			qtyOwned: 2
		});
	});

	it('should map owned→own and wanted→want in API call', async () => {
		const setUserFlagsSpy = vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('test.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: false, wanted: true }
		});

		const change = {
			file,
			setID: 1,
			changes: { owned: false, wanted: true },
			timestamp: Date.now()
		};

		await service.testSyncToApi(change);

		const callArgs = setUserFlagsSpy.mock.calls[0][1];
		expect(callArgs.own).toBe(false);
		expect(callArgs.want).toBe(true);
	});

	it('should map userRating→rating in API call', async () => {
		const setUserFlagsSpy = vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('test.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: false, wanted: false, userRating: 5 }
		});

		const change = {
			file,
			setID: 1,
			changes: { userRating: 5 },
			timestamp: Date.now()
		};

		await service.testSyncToApi(change);

		const callArgs = setUserFlagsSpy.mock.calls[0][1];
		expect(callArgs.rating).toBe(5);
	});

	it('should update file frontmatter after successful sync', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('test.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: true, wanted: false, qtyOwned: 1 }
		});

		const change = {
			file,
			setID: 1,
			changes: { owned: true, qtyOwned: 1 },
			timestamp: Date.now()
		};

		await service.testSyncToApi(change);

		expect(app.fileManager.processFrontMatter).toHaveBeenCalledOnce();
		expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
	});

	it('should update state cache after successful sync', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('test.md');
		const frontmatter = { setID: 1, owned: true, wanted: false, qtyOwned: 1 };
		app.metadataCache.getFileCache.mockReturnValue({ frontmatter });

		const change = {
			file,
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		};

		await service.testSyncToApi(change);

		// Cache should be updated
		const cached = stateCache.get(file.path);
		expect(cached?.owned).toBe(true);
	});

	it('should throw error when API returns false', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(false);
		const file = createMockFile('test.md');

		const change = {
			file,
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		};

		await expect(service.testSyncToApi(change)).rejects.toThrow('API returned error');
	});

	it('should throw when API throws BricksetApiError', async () => {
		const { BricksetApiError } = await import('../bricksetApi');
		vi.spyOn(apiService, 'setUserFlags').mockRejectedValue(
			new BricksetApiError('Unauthorized', 401, 'unauthorized')
		);
		const file = createMockFile('test.md');

		const change = {
			file,
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		};

		await expect(service.testSyncToApi(change)).rejects.toThrow('Unauthorized');
	});

	it('should show notification when showSyncNotifications is true', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const serviceWithNotifications = new TestableSyncBackService(
			app, apiService, stateCache,
			makeSettings({ showSyncNotifications: true })
		);
		const file = createMockFile('test.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: true }
		});

		const change = {
			file,
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		};

		// Should not throw - notification is shown via Notice constructor
		await expect(serviceWithNotifications.testSyncToApi(change)).resolves.toBeUndefined();
	});
});

describe('SyncBackService - processQueue()', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, makeSettings());
		vi.clearAllMocks();
	});

	it('should do nothing when queue is empty', async () => {
		const setUserFlagsSpy = vi.spyOn(apiService, 'setUserFlags');

		await service.testProcessQueue();

		expect(setUserFlagsSpy).not.toHaveBeenCalled();
	});

	it('should do nothing when already processing', async () => {
		const setUserFlagsSpy = vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		service.setIsProcessing(true);

		// Manually add to queue
		service.getChangeQueue().set('test.md', {
			file: createMockFile('test.md'),
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		});

		await service.testProcessQueue();

		expect(setUserFlagsSpy).not.toHaveBeenCalled();
	});

	it('should process all queued changes', async () => {
		const setUserFlagsSpy = vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: true }
		});

		// Add two changes to queue
		service.getChangeQueue().set('file1.md', {
			file: createMockFile('file1.md'),
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		});
		service.getChangeQueue().set('file2.md', {
			file: createMockFile('file2.md'),
			setID: 2,
			changes: { wanted: true },
			timestamp: Date.now()
		});

		await service.testProcessQueue();

		expect(setUserFlagsSpy).toHaveBeenCalledTimes(2);
		expect(service.getChangeQueue().size).toBe(0);
	});

	it('should clear queue before processing (prevents re-processing)', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: true }
		});

		service.getChangeQueue().set('file1.md', {
			file: createMockFile('file1.md'),
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		});

		await service.testProcessQueue();

		expect(service.getChangeQueue().size).toBe(0);
	});

	it('should save state cache after processing', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const saveSpy = vi.spyOn(stateCache, 'save').mockResolvedValue();
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: true }
		});

		service.getChangeQueue().set('file1.md', {
			file: createMockFile('file1.md'),
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		});

		await service.testProcessQueue();

		expect(saveSpy).toHaveBeenCalledOnce();
	});

	it('should continue processing other changes when one fails', async () => {
		const setUserFlagsSpy = vi.spyOn(apiService, 'setUserFlags')
			.mockRejectedValueOnce(new Error('API error for file1'))
			.mockResolvedValueOnce(true);
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 2, owned: true }
		});

		service.getChangeQueue().set('file1.md', {
			file: createMockFile('file1.md'),
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		});
		service.getChangeQueue().set('file2.md', {
			file: createMockFile('file2.md'),
			setID: 2,
			changes: { wanted: true },
			timestamp: Date.now()
		});

		// Should not throw even though file1 fails
		await expect(service.testProcessQueue()).resolves.toBeUndefined();

		// Both were attempted
		expect(setUserFlagsSpy).toHaveBeenCalledTimes(2);
	});

	it('should show error notification when sync fails and showSyncNotifications is true', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockRejectedValue(new Error('Sync failed'));
		const serviceWithNotifications = new TestableSyncBackService(
			app, apiService, stateCache,
			makeSettings({ showSyncNotifications: true })
		);

		serviceWithNotifications.getChangeQueue().set('file1.md', {
			file: createMockFile('file1.md'),
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		});

		// Should not throw - error is caught and shown as Notice
		await expect(serviceWithNotifications.testProcessQueue()).resolves.toBeUndefined();
	});

	it('should reset isProcessing flag after completion', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: true }
		});

		service.getChangeQueue().set('file1.md', {
			file: createMockFile('file1.md'),
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		});

		await service.testProcessQueue();

		expect(service.isCurrentlyProcessing()).toBe(false);
	});
});

describe('SyncBackService - syncFile()', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: SyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new SyncBackService(app, apiService, stateCache, makeSettings());
		vi.clearAllMocks();
	});

	it('should throw when file is not a LEGO set note', async () => {
		const file = createMockFile('random-note.md');
		app.metadataCache.getFileCache.mockReturnValue(null);

		await expect(service.syncFile(file)).rejects.toThrow('Not a LEGO set note');
	});

	it('should throw when no frontmatter found', async () => {
		const file = createMockFile('lego-note.md');
		// isLegoSetNote returns true (has tags+setID), but then getFileCache returns null
		app.metadataCache.getFileCache
			.mockReturnValueOnce({ frontmatter: { tags: ['lego', 'set'], setID: 1 } }) // isLegoSetNote check
			.mockReturnValueOnce(null); // second call in syncFile

		await expect(service.syncFile(file)).rejects.toThrow('No frontmatter found');
	});

	it('should call setUserFlags with current frontmatter values', async () => {
		const setUserFlagsSpy = vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('lego-note.md');
		const frontmatter = {
			tags: ['lego', 'set'],
			setID: 23351,
			owned: true,
			wanted: false,
			qtyOwned: 3,
			userRating: 4
		};
		app.metadataCache.getFileCache.mockReturnValue({ frontmatter });

		await service.syncFile(file);

		expect(setUserFlagsSpy).toHaveBeenCalledWith(23351, {
			own: true,
			want: false,
			qtyOwned: 3,
			rating: 4
		});
	});

	it('should return true on successful sync', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('lego-note.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 1, owned: false, wanted: false }
		});

		const result = await service.syncFile(file);

		expect(result).toBe(true);
	});

	it('should update state cache after successful sync', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const saveSpy = vi.spyOn(stateCache, 'save').mockResolvedValue();
		const file = createMockFile('lego-note.md');
		const frontmatter = { tags: ['lego', 'set'], setID: 1, owned: true, wanted: false };
		app.metadataCache.getFileCache.mockReturnValue({ frontmatter });

		await service.syncFile(file);

		expect(saveSpy).toHaveBeenCalledOnce();
		expect(stateCache.get(file.path)?.owned).toBe(true);
	});
});

describe('SyncBackService - updateFileFrontmatter()', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, makeSettings());
		vi.clearAllMocks();
	});

	it('should apply owned change to frontmatter', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('test.md');
		let capturedFrontmatter: any = {};

		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, owned: true }
		});
		app.fileManager.processFrontMatter.mockImplementation(async (_file: any, fn: (fm: any) => void) => {
			fn(capturedFrontmatter);
		});

		const change = {
			file,
			setID: 1,
			changes: { owned: true, qtyOwned: 0 },
			timestamp: Date.now()
		};

		await service.testSyncToApi(change);

		expect(capturedFrontmatter.owned).toBe(true);
		expect(capturedFrontmatter.qtyOwned).toBe(0);
	});

	it('should apply wanted change to frontmatter', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('test.md');
		let capturedFrontmatter: any = {};

		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, wanted: true }
		});
		app.fileManager.processFrontMatter.mockImplementation(async (_file: any, fn: (fm: any) => void) => {
			fn(capturedFrontmatter);
		});

		const change = {
			file,
			setID: 1,
			changes: { wanted: true },
			timestamp: Date.now()
		};

		await service.testSyncToApi(change);

		expect(capturedFrontmatter.wanted).toBe(true);
	});

	it('should apply userRating change to frontmatter', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('test.md');
		let capturedFrontmatter: any = {};

		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { setID: 1, userRating: 3 }
		});
		app.fileManager.processFrontMatter.mockImplementation(async (_file: any, fn: (fm: any) => void) => {
			fn(capturedFrontmatter);
		});

		const change = {
			file,
			setID: 1,
			changes: { userRating: 3 },
			timestamp: Date.now()
		};

		await service.testSyncToApi(change);

		expect(capturedFrontmatter.userRating).toBe(3);
	});
});

describe('SyncBackService - getQueueSize() and isCurrentlyProcessing()', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, makeSettings());
		vi.clearAllMocks();
	});

	it('should return 0 when queue is empty', () => {
		expect(service.getQueueSize()).toBe(0);
	});

	it('should return queue size when items are queued', () => {
		service.getChangeQueue().set('file1.md', { file: createMockFile('file1.md'), setID: 1, changes: {}, timestamp: 0 });
		service.getChangeQueue().set('file2.md', { file: createMockFile('file2.md'), setID: 2, changes: {}, timestamp: 0 });
		expect(service.getQueueSize()).toBe(2);
	});

	it('should return false when not processing', () => {
		expect(service.isCurrentlyProcessing()).toBe(false);
	});

	it('should return true when processing', () => {
		service.setIsProcessing(true);
		expect(service.isCurrentlyProcessing()).toBe(true);
	});
});

describe('SyncBackService - syncFile() additional paths', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: SyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new SyncBackService(app, apiService, stateCache, makeSettings({ showSyncNotifications: true }));
		vi.clearAllMocks();
	});

	it('should throw when setID is missing from frontmatter (line 342)', async () => {
		const file = createMockFile('lego-note.md');
		// isLegoSetNote returns true (has tags+setID), but syncFile's own check finds no setID
		app.metadataCache.getFileCache
			.mockReturnValueOnce({ frontmatter: { tags: ['lego', 'set'], setID: 1 } }) // isLegoSetNote
			.mockReturnValueOnce({ frontmatter: { tags: ['lego', 'set'] } }); // syncFile - no setID

		await expect(service.syncFile(file)).rejects.toThrow('No setID in frontmatter');
	});

	it('should show success notification when showSyncNotifications is true (line 366)', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);
		const file = createMockFile('lego-note.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 1, owned: true, wanted: false }
		});

		// Should not throw - notification is shown via Notice constructor
		await expect(service.syncFile(file)).resolves.toBe(true);
	});

	it('should return false from isLegoSetNote when no cache (line 304)', async () => {
		const file = createMockFile('random-note.md');
		app.metadataCache.getFileCache.mockReturnValue(null);

		await expect(service.syncFile(file)).rejects.toThrow('Not a LEGO set note');
	});
});
describe('SyncBackService - handleFileChange() no-frontmatter path (lines 88-89)', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, makeSettings());
		vi.clearAllMocks();
	});

	afterEach(() => {
		service.stopWatching();
	});

	it('should return early when isLegoSetNote passes but second getFileCache has no frontmatter (lines 88-89)', async () => {
		const file = createMockFile('LEGO Sets/75192.md');
		// First call: isLegoSetNote → has tags+setID → returns true
		// Second call: handleFileChange's own getFileCache → no frontmatter
		app.metadataCache.getFileCache
			.mockReturnValueOnce({ frontmatter: { tags: ['lego', 'set'], setID: 23351 } })
			.mockReturnValueOnce(null);

		await service.testHandleFileChange(file);

		// No change queued — returned early at line 89
		expect(service.getChangeQueue().size).toBe(0);
	});

	it('should return early when second getFileCache returns cache with no frontmatter property', async () => {
		const file = createMockFile('LEGO Sets/75192.md');
		app.metadataCache.getFileCache
			.mockReturnValueOnce({ frontmatter: { tags: ['lego', 'set'], setID: 23351 } })
			.mockReturnValueOnce({}); // cache exists but no frontmatter property

		await service.testHandleFileChange(file);

		expect(service.getChangeQueue().size).toBe(0);
	});
});

describe('SyncBackService - scheduleProcessing() timer callback (line 204)', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		vi.useFakeTimers();
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, makeSettings({ syncDebounceMs: 100 }));
		vi.clearAllMocks();
	});

	afterEach(() => {
		service.stopWatching();
		vi.useRealTimers();
	});

	it('should call processQueue after debounce timer fires (line 204)', async () => {
		const processQueueSpy = vi.spyOn(service as any, 'processQueue').mockResolvedValue(undefined);

		service.testScheduleProcessing();

		// Timer hasn't fired yet
		expect(processQueueSpy).not.toHaveBeenCalled();

		// Advance timers to fire the setTimeout callback
		await vi.runAllTimersAsync();

		expect(processQueueSpy).toHaveBeenCalledOnce();
	});

	it('should cancel previous timer when scheduleProcessing called twice', async () => {
		const processQueueSpy = vi.spyOn(service as any, 'processQueue').mockResolvedValue(undefined);

		service.testScheduleProcessing();
		service.testScheduleProcessing(); // second call cancels first

		await vi.runAllTimersAsync();

		// Only called once (second schedule replaced first)
		expect(processQueueSpy).toHaveBeenCalledTimes(1);
	});
});

describe('SyncBackService - syncFile() returns false (line 360)', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: SyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new SyncBackService(app, apiService, stateCache, makeSettings({ showSyncNotifications: true }));
		vi.clearAllMocks();
	});

	afterEach(() => {
		service.stopWatching();
	});

	it('should return false and skip cache update when setUserFlags returns false (line 360)', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(false);
		const file = createMockFile('lego-note.md');
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: ['lego', 'set'], setID: 1, owned: true, wanted: false }
		});

		const result = await service.syncFile(file);
		expect(result).toBe(false);
	});
});

describe('SyncBackService - uncovered branch coverage', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(app, apiService, stateCache, makeSettings());
		vi.clearAllMocks();
	});

	afterEach(() => {
		service.stopWatching();
	});

	it('should set owned=false when qtyOwned changes to 0 (line 172-173)', async () => {
		// Pre-populate cache with qtyOwned=1, owned=true
		stateCache.set('LEGO Sets/75192.md', {
			setID: 23351,
			owned: true,
			wanted: false,
			qtyOwned: 1,
			lastModified: 0
		});

		const file = createMockFile('LEGO Sets/75192.md');
		// Frontmatter now has qtyOwned=0, owned=true (only qtyOwned changed)
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: {
				tags: ['lego', 'set'],
				setID: 23351,
				owned: true,
				wanted: false,
				qtyOwned: 0
			}
		});

		await service.testHandleFileChange(file);

		const queue = service.getChangeQueue();
		expect(queue.size).toBe(1);
		const change = queue.get('LEGO Sets/75192.md');
		expect(change?.changes.owned).toBe(false);
		expect(change?.changes.qtyOwned).toBe(0);
	});

	it('should set owned=true when qtyOwned changes from 0 to positive (line 168-170)', async () => {
		// Pre-populate cache with qtyOwned=0, owned=false
		stateCache.set('LEGO Sets/75192.md', {
			setID: 23351,
			owned: false,
			wanted: false,
			qtyOwned: 0,
			lastModified: 0
		});

		const file = createMockFile('LEGO Sets/75192.md');
		// Frontmatter now has qtyOwned=2 (changed from 0 to 2)
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: {
				tags: ['lego', 'set'],
				setID: 23351,
				owned: false,
				wanted: false,
				qtyOwned: 2
			}
		});

		await service.testHandleFileChange(file);

		const queue = service.getChangeQueue();
		expect(queue.size).toBe(1);
		const change = queue.get('LEGO Sets/75192.md');
		expect(change?.changes.owned).toBe(true);
		expect(change?.changes.qtyOwned).toBe(2);
	});

	it('should use fallback 2000ms when syncDebounceMs is 0 (line 205)', async () => {
		vi.useFakeTimers();
		const zeroDebounceService = new TestableSyncBackService(
			app, apiService, stateCache,
			makeSettings({ syncDebounceMs: 0 })
		);
		const processQueueSpy = vi.spyOn(zeroDebounceService as any, 'processQueue').mockResolvedValue(undefined);

		zeroDebounceService.testScheduleProcessing();

		// Should not fire before 2000ms
		await vi.advanceTimersByTimeAsync(1999);
		expect(processQueueSpy).not.toHaveBeenCalled();

		// Should fire at 2000ms
		await vi.advanceTimersByTimeAsync(1);
		expect(processQueueSpy).toHaveBeenCalledOnce();

		zeroDebounceService.stopWatching();
		vi.useRealTimers();
	});

	it('should handle null cache after successful syncToApi (line 269)', async () => {
		vi.spyOn(apiService, 'setUserFlags').mockResolvedValue(true);

		const file = createMockFile('LEGO Sets/75192.md');
		const change = {
			file,
			setID: 23351,
			changes: { owned: true }
		};

		// After success, getFileCache returns null → cache?.frontmatter is falsy → skip updateFromFrontmatter
		app.metadataCache.getFileCache.mockReturnValue(null);

		// Should not throw
		await expect(service.testSyncToApi(change)).resolves.toBeUndefined();
	});

	it('should return false from isLegoSetNote when tags is a string not an array (line 317)', async () => {
		const file = createMockFile('LEGO Sets/75192.md');
		// tags is a string, not an array → Array.isArray returns false → hasLegoTag = false
		app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: {
				tags: 'lego set',
				setID: 23351
			}
		});

		await service.testHandleFileChange(file);

		// isLegoSetNote returns false → no change queued
		expect(service.getChangeQueue().size).toBe(0);
	});
});

describe('SyncBackService - processQueue() non-Error thrown branch (line 215)', () => {
	let app: any;
	let stateCache: StateCache;
	let apiService: BricksetApiService;
	let service: TestableSyncBackService;

	beforeEach(async () => {
		app = createMockApp();
		stateCache = new StateCache(app, '.obsidian/plugins/brickset');
		await stateCache.load();
		apiService = new BricksetApiService('test-key', 'test-hash');
		service = new TestableSyncBackService(
			app, apiService, stateCache,
			{ ...makeSettings(), showSyncNotifications: true }
		);
		vi.clearAllMocks();
	});

	afterEach(() => {
		service.stopWatching();
	});

	it('should use String(error) when a non-Error is thrown during sync (line 215 false branch)', async () => {
		// Throw a plain string (not an Error instance) to exercise the String(error) branch
		vi.spyOn(apiService, 'setUserFlags').mockRejectedValue('plain string failure');

		service.getChangeQueue().set('file1.md', {
			file: createMockFile('file1.md'),
			setID: 1,
			changes: { owned: true },
			timestamp: Date.now()
		});

		// Should not throw — error is caught and shown as Notice
		await expect(service.testProcessQueue()).resolves.toBeUndefined();
	});
});
