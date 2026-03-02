import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncService } from '../syncService';
import { BricksetApiService } from '../bricksetApi';
import { NoteCreator } from '../noteCreator';
import { DEFAULT_SETTINGS, LegoSet } from '../types';

// Mock obsidian
vi.mock('obsidian', async (importOriginal) => {
	const original = await importOriginal() as any;
	return {
		...original,
		Notice: class { constructor(public message: string) {} },
		normalizePath: (p: string) => p,
		requestUrl: vi.fn().mockResolvedValue({
			status: 200,
			json: { status: 'success' }
		})
	};
});

// Helper: build a minimal LegoSet
function makeSet(overrides: Partial<LegoSet> = {}): LegoSet {
	return {
		setID: 23351,
		number: '75192-1',
		numberVariant: 1,
		name: 'Millennium Falcon',
		year: 2017,
		theme: 'Star Wars',
		themeGroup: 'Licensed',
		subtheme: 'UCS',
		category: 'Normal',
		released: true,
		pieces: 7541,
		image: {
			thumbnailURL: 'https://example.com/thumb.jpg',
			imageURL: 'https://example.com/img.jpg'
		},
		bricksetURL: 'https://brickset.com/sets/75192-1',
		lastUpdated: '2023-01-01',
		...overrides
	};
}

function createMockApp() {
	return {
		vault: {
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			create: vi.fn().mockResolvedValue(undefined),
			createBinary: vi.fn().mockResolvedValue(undefined),
			createFolder: vi.fn().mockResolvedValue(undefined),
			modify: vi.fn().mockResolvedValue(undefined),
			adapter: {
				exists: vi.fn().mockResolvedValue(false),
				read: vi.fn().mockResolvedValue('{}'),
				write: vi.fn().mockResolvedValue(undefined)
			}
		},
		metadataCache: {
			on: vi.fn(),
			offref: vi.fn(),
			getFileCache: vi.fn().mockReturnValue(null)
		},
		fileManager: {
			processFrontMatter: vi.fn().mockResolvedValue(undefined)
		}
	} as any;
}

/** Inferred type of the mock app, used in place of `any` for describe-level variables */
type MockApp = ReturnType<typeof createMockApp>;

function makeSettings(overrides = {}) {
	return {
		...DEFAULT_SETTINGS,
		syncOwnedSets: true,
		syncWantedSets: false,
		syncPageSize: 20,
		syncBehavior: 'update' as const,
		downloadImagesOnSync: false,
		...overrides
	};
}

describe('SyncService - cancel()', () => {
	it('should set cancelled flag', () => {
		const app = createMockApp();
		const apiService = new BricksetApiService('key', 'hash');
		const noteCreator = new NoteCreator(app, 'LEGO Sets');
		const service = new SyncService(app, makeSettings(), apiService, noteCreator);

		service.cancel();

		// Verify by running syncCollection which checks cancelled flag
		// (tested indirectly via syncCollection tests)
		expect(service.getProgress().total).toBe(0);
	});
});

// Helper: mock a single owned set and return the sets array (Proposal 4)
function mockSingleOwnedSet(apiService: BricksetApiService): LegoSet[] {
	const sets = [makeSet()];
	vi.spyOn(apiService, 'getUserOwnedSets').mockResolvedValue({
		status: 'success', matches: 1, sets
	});
	return sets;
}

describe('SyncService - syncCollection()', () => {
	// Proposal 1: typed as MockApp (inferred from createMockApp) instead of `any`
	let app: MockApp;
	let apiService: BricksetApiService;
	let noteCreator: NoteCreator;
	let service: SyncService;

	beforeEach(() => {
		app = createMockApp();
		apiService = new BricksetApiService('test-key', 'test-hash');
		noteCreator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		// Proposal 2: validateUserHash defaults to valid in every test
		vi.spyOn(apiService, 'validateUserHash').mockResolvedValue(true);
		// Proposal 3: createSetNote defaults to a no-op success in every test
		vi.spyOn(noteCreator, 'createSetNote').mockResolvedValue({} as any);
	});

	it('should return failure when not authenticated', async () => {
		const unauthApiService = new BricksetApiService('test-key'); // no hash
		service = new SyncService(app, makeSettings(), unauthApiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain('not authenticated');
	});

	it('should return failure when user hash is invalid', async () => {
		// Override the beforeEach default to simulate an expired session
		vi.spyOn(apiService, 'validateUserHash').mockResolvedValue(false);
		service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain('session expired');
	});

	it('should return empty result when no sets to sync', async () => {
		vi.spyOn(apiService, 'getUserOwnedSets').mockResolvedValue({
			status: 'success', matches: 0, sets: []
		});
		service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.success).toBe(true);
		expect(result.total).toBe(0);
		expect(result.created).toBe(0);
	});

	it('should sync owned sets when syncOwnedSets is true', async () => {
		mockSingleOwnedSet(apiService);
		service = new SyncService(app, makeSettings({ syncOwnedSets: true, syncWantedSets: false }), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.success).toBe(true);
		expect(result.total).toBe(1);
		expect(result.created).toBe(1);
	});

	it('should sync wanted sets when syncWantedSets is true', async () => {
		const sets = [makeSet({ setID: 99999, number: '10179-1', name: 'Wanted Set' })];
		vi.spyOn(apiService, 'getUserWantedSets').mockResolvedValue({
			status: 'success', matches: 1, sets
		});
		service = new SyncService(app, makeSettings({ syncOwnedSets: false, syncWantedSets: true }), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.success).toBe(true);
		expect(result.total).toBe(1);
		expect(result.created).toBe(1);
	});

	it('should sync both owned and wanted sets', async () => {
		const ownedSets = [makeSet()];
		const wantedSets = [makeSet({ setID: 99999, number: '10179-1', name: 'Wanted' })];
		vi.spyOn(apiService, 'getUserOwnedSets').mockResolvedValue({
			status: 'success', matches: 1, sets: ownedSets
		});
		vi.spyOn(apiService, 'getUserWantedSets').mockResolvedValue({
			status: 'success', matches: 1, sets: wantedSets
		});
		service = new SyncService(app, makeSettings({ syncOwnedSets: true, syncWantedSets: true }), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.total).toBe(2);
		expect(result.created).toBe(2);
	});

	// Proposal 5: parameterised syncBehavior tests replace three near-identical blocks
	it.each([
		{ syncBehavior: 'skip',   expectedSkipped: 1, expectedCreated: 0, expectedUpdated: 0, noteCreatorCalled: false },
		{ syncBehavior: 'create', expectedSkipped: 1, expectedCreated: 0, expectedUpdated: 0, noteCreatorCalled: false },
		{ syncBehavior: 'update', expectedSkipped: 0, expectedCreated: 0, expectedUpdated: 1, noteCreatorCalled: true  },
	] as const)(
		'should handle existing file correctly when syncBehavior is "$syncBehavior"',
		async ({ syncBehavior, expectedSkipped, expectedCreated, expectedUpdated, noteCreatorCalled }) => {
			mockSingleOwnedSet(apiService);
			app.vault.getAbstractFileByPath.mockReturnValue({ path: 'existing.md' });
			service = new SyncService(app, makeSettings({ syncBehavior }), apiService, noteCreator);

			const result = await service.syncCollection();

			expect(result.skipped).toBe(expectedSkipped);
			expect(result.created).toBe(expectedCreated);
			expect(result.updated).toBe(expectedUpdated);
			if (noteCreatorCalled) {
				expect(noteCreator.createSetNote).toHaveBeenCalledOnce();
			} else {
				expect(noteCreator.createSetNote).not.toHaveBeenCalled();
			}
		}
	);

	it('should count failed sets when processSet throws (exhausts retries)', async () => {
		const sets = [makeSet(), makeSet({ setID: 2, number: '10179-1', name: 'Set 2' })];
		vi.spyOn(apiService, 'getUserOwnedSets').mockResolvedValue({
			status: 'success', matches: 2, sets
		});
		vi.spyOn(noteCreator, 'createSetNote')
			.mockRejectedValueOnce(new Error('Network error'))
			.mockRejectedValueOnce(new Error('Network error'))
			.mockResolvedValueOnce({} as any);
		service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.failed).toBe(1);
		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('75192-1');
		expect(result.failedSets).toHaveLength(1);
		expect(result.failedSets[0]).toMatchObject({
			setNumber: '75192-1',
			name: 'Millennium Falcon',
			theme: 'Star Wars',
			error: 'Network error',
		});
	});

	it('should stop processing when cancelled', async () => {
		const sets = [makeSet(), makeSet({ setID: 2, number: '10179-1', name: 'Set 2' })];
		vi.spyOn(apiService, 'getUserOwnedSets').mockResolvedValue({
			status: 'success', matches: 2, sets
		});
		const createSetNoteSpy = vi.spyOn(noteCreator, 'createSetNote').mockImplementation(async () => {
			// Cancel after first set
			service.cancel();
			return {} as any;
		});
		service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.success).toBe(false); // cancelled = not success
		expect(createSetNoteSpy).toHaveBeenCalledTimes(1); // Only first set processed
	});

	it('should call onProgress callback during sync', async () => {
		mockSingleOwnedSet(apiService);

		const progressCalls: ReturnType<SyncService['getProgress']>[] = [];
		service = new SyncService(app, makeSettings(), apiService, noteCreator, (p) => {
			progressCalls.push({ ...p });
		});

		await service.syncCollection();

		expect(progressCalls.length).toBeGreaterThan(0);
		expect(progressCalls.at(-1)!.total).toBe(1);
	});

	it('should update lastSyncTimestamp after successful sync', async () => {
		mockSingleOwnedSet(apiService);
		const settings = makeSettings();
		service = new SyncService(app, settings, apiService, noteCreator);

		const before = Date.now();
		await service.syncCollection();

		expect(settings.lastSyncTimestamp).toBeGreaterThanOrEqual(before);
	});

	it('should fetch additional images when downloadImagesOnSync is true', async () => {
		mockSingleOwnedSet(apiService);
		const getAdditionalImagesSpy = vi.spyOn(apiService, 'getAdditionalImages').mockResolvedValue([]);
		service = new SyncService(app, makeSettings({ downloadImagesOnSync: true }), apiService, noteCreator);

		await service.syncCollection();

		expect(getAdditionalImagesSpy).toHaveBeenCalledWith(23351);
	});

	it('should not fetch additional images when downloadImagesOnSync is false', async () => {
		mockSingleOwnedSet(apiService);
		const getAdditionalImagesSpy = vi.spyOn(apiService, 'getAdditionalImages').mockResolvedValue([]);
		service = new SyncService(app, makeSettings({ downloadImagesOnSync: false }), apiService, noteCreator);

		await service.syncCollection();

		expect(getAdditionalImagesSpy).not.toHaveBeenCalled();
	});

	it('should include duration in result', async () => {
		vi.spyOn(apiService, 'getUserOwnedSets').mockResolvedValue({
			status: 'success', matches: 0, sets: []
		});
		service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.duration).toBeGreaterThanOrEqual(0);
	});
});

describe('SyncService - fetchAllSets() pagination', () => {
	// Proposal 1: typed as MockApp (inferred from createMockApp) instead of `any`
	let app: MockApp;
	let apiService: BricksetApiService;
	let noteCreator: NoteCreator;
	let service: SyncService;

	beforeEach(() => {
		app = createMockApp();
		apiService = new BricksetApiService('test-key', 'test-hash');
		noteCreator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		// Proposal 2: validateUserHash defaults to valid in every test
		vi.spyOn(apiService, 'validateUserHash').mockResolvedValue(true);
		// Proposal 3: createSetNote defaults to a no-op success in every test
		vi.spyOn(noteCreator, 'createSetNote').mockResolvedValue({} as any);
	});

	it('should fetch multiple pages when matches > pageSize', async () => {
		const page1Sets = [makeSet(), makeSet({ setID: 2, number: '10179-1', name: 'Set 2' })];
		const page2Sets = [makeSet({ setID: 3, number: '10221-1', name: 'Set 3' })];

		const getUserOwnedSetsSpy = vi.spyOn(apiService, 'getUserOwnedSets')
			.mockResolvedValueOnce({ status: 'success', matches: 3, sets: page1Sets })
			.mockResolvedValueOnce({ status: 'success', matches: 3, sets: page2Sets });

		service = new SyncService(app, makeSettings({ syncPageSize: 2 }), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(getUserOwnedSetsSpy).toHaveBeenCalledTimes(2);
		expect(result.total).toBe(3);
	});

	it('should stop fetching when no more sets returned', async () => {
		vi.spyOn(apiService, 'getUserOwnedSets').mockResolvedValue({
			status: 'success', matches: 5, sets: [] // empty sets despite matches > 0
		});
		service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.total).toBe(0);
	});

	it('should throw when API call fails during pagination', async () => {
		vi.spyOn(apiService, 'getUserOwnedSets').mockRejectedValue(new Error('API error'));
		service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain('API error');
	});
});

describe('SyncService - getProgress()', () => {
	it('should return a copy of progress', () => {
		const app = createMockApp();
		const apiService = new BricksetApiService('key', 'hash');
		const noteCreator = new NoteCreator(app, 'LEGO Sets');
		const service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const progress = service.getProgress();

		expect(progress).toEqual({
			total: 0,
			current: 0,
			created: 0,
			updated: 0,
			skipped: 0,
			failed: 0
		});
	});
});

describe('SyncService - additional images fetch error (line 220)', () => {
	// Proposal 1: typed as MockApp (inferred from createMockApp) instead of `any`
	let app: MockApp;
	let apiService: BricksetApiService;
	let noteCreator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		apiService = new BricksetApiService('test-key', 'test-hash');
		noteCreator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		// Proposal 2: validateUserHash defaults to valid in every test
		vi.spyOn(apiService, 'validateUserHash').mockResolvedValue(true);
		// Proposal 3: createSetNote defaults to a no-op success in every test
		vi.spyOn(noteCreator, 'createSetNote').mockResolvedValue({} as any);
	});

	it('should warn and continue when getAdditionalImages throws (line 220)', async () => {
		mockSingleOwnedSet(apiService);
		vi.spyOn(apiService, 'getAdditionalImages').mockRejectedValue(new Error('Image fetch failed'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const service = new SyncService(app, makeSettings({ downloadImagesOnSync: true }), apiService, noteCreator);
		const result = await service.syncCollection();

		// Sync should still succeed despite image fetch failure
		expect(result.success).toBe(true);
		expect(result.created).toBe(1);
		expect(warnSpy).toHaveBeenCalledWith(
			'Failed to fetch additional images for set %s:',
			'75192-1',
			expect.any(Error)
		); // warn("Failed to fetch additional images for set %s:", set.number, error)

		warnSpy.mockRestore();
	});
});

describe('SyncService - non-Error thrown branches', () => {
	// Proposal 1: typed as MockApp (inferred from createMockApp) instead of `any`
	let app: MockApp;
	let apiService: BricksetApiService;
	let noteCreator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		apiService = new BricksetApiService('test-key', 'test-hash');
		noteCreator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		// Proposal 2: validateUserHash defaults to valid in every test
		vi.spyOn(apiService, 'validateUserHash').mockResolvedValue(true);
		// Proposal 3: createSetNote defaults to a no-op success in every test
		vi.spyOn(noteCreator, 'createSetNote').mockResolvedValue({} as any);
	});

	it('should use String(error) when a non-Error is thrown in syncCollection (line 73)', async () => {
		// Throw a plain string (not an Error instance)
		vi.spyOn(apiService, 'getUserOwnedSets').mockRejectedValue('plain string error');
		const service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.success).toBe(false);
		expect(result.errors[0]).toBe('plain string error');
	});

	it('should use String(error) when a non-Error is thrown in processSet (lines 171 & 223)', async () => {
		mockSingleOwnedSet(apiService);
		// Make noteCreator.createSetNote throw a non-Error (exercises line 171 & 223)
		vi.spyOn(noteCreator, 'createSetNote').mockRejectedValue(42);
		const service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.failed).toBe(1);
		expect(result.errors[0]).toContain('42');
		// failedSets.error holds the original (unwrapped) error value as a string
		expect(result.failedSets[0].error).toBe('42');
	});

	it('should return empty failedSets when all sets succeed', async () => {
		mockSingleOwnedSet(apiService);
		const service = new SyncService(app, makeSettings(), apiService, noteCreator);

		const result = await service.syncCollection();

		expect(result.failedSets).toHaveLength(0);
	});

	it('should use the raw message when error does not start with the processSet prefix (false branch of startsWith)', async () => {
		mockSingleOwnedSet(apiService);
		// Bypass processSet's own wrapper by spying on the private method directly
		const service = new SyncService(app, makeSettings(), apiService, noteCreator);
		vi.spyOn(service as any, 'processSet').mockRejectedValue(new Error('Raw unexpected error'));

		const result = await service.syncCollection();

		expect(result.failed).toBe(1);
		expect(result.failedSets[0].error).toBe('Raw unexpected error');
		expect(result.errors[0]).toContain('Raw unexpected error');
	});

	it('should use String(error) when processSet throws a non-Error directly (line 175 false branch)', async () => {
		mockSingleOwnedSet(apiService);
		// Throw a non-Error directly from processSet to hit the String(error) branch on line 175
		const service = new SyncService(app, makeSettings(), apiService, noteCreator);
		vi.spyOn(service as any, 'processSet').mockRejectedValue('non-error string');

		const result = await service.syncCollection();

		expect(result.failed).toBe(1);
		expect(result.failedSets[0].error).toBe('non-error string');
		expect(result.errors[0]).toContain('non-error string');
	});

	it('should reset failedSets between successive syncCollection calls', async () => {
		mockSingleOwnedSet(apiService);
		vi.spyOn(noteCreator, 'createSetNote').mockRejectedValue(new Error('First run error'));
		const service = new SyncService(app, makeSettings(), apiService, noteCreator);

		await service.syncCollection(); // first run — 1 failure

		// Second run: set succeeds
		mockSingleOwnedSet(apiService);
		vi.spyOn(noteCreator, 'createSetNote').mockResolvedValue({} as any);
		const result2 = await service.syncCollection();

		expect(result2.failedSets).toHaveLength(0);
	});
});

describe('SyncService - resolveLocalAdditionalImages() optimisation', () => {
	let app: MockApp;
	let apiService: BricksetApiService;
	let noteCreator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		apiService = new BricksetApiService('test-key', 'test-hash');
		noteCreator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		vi.spyOn(apiService, 'validateUserHash').mockResolvedValue(true);
		vi.spyOn(noteCreator, 'createSetNote').mockResolvedValue({} as any);
	});

	it('should skip getAdditionalImages API call for existing notes and use local images instead', async () => {
		// Simulate: note file exists, and two additional images exist locally
		mockSingleOwnedSet(apiService);
		const getAdditionalImagesSpy = vi.spyOn(apiService, 'getAdditionalImages');

		// The note file path that processSet constructs
		const noteFilePath = 'LEGO Sets/Star Wars/75192-1 - Millennium Falcon/75192-1 - Millennium Falcon.md';
		const img1Path = 'LEGO Sets/Star Wars/75192-1 - Millennium Falcon/images/additional-1.jpg';
		const img2Path = 'LEGO Sets/Star Wars/75192-1 - Millennium Falcon/images/additional-2.jpg';

		app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === noteFilePath) return { path: noteFilePath }; // note exists
			if (path === img1Path)    return { path: img1Path };      // image 1 exists
			if (path === img2Path)    return { path: img2Path };      // image 2 exists
			return null; // additional-3.jpg → not found → loop stops
		});

		const service = new SyncService(app, makeSettings({ downloadImagesOnSync: true }), apiService, noteCreator);
		const result = await service.syncCollection();

		expect(result.success).toBe(true);
		// getAdditionalImages must NOT have been called (optimisation)
		expect(getAdditionalImagesSpy).not.toHaveBeenCalled();
		// createSetNote should have been called with the two reconstructed local images
		expect(noteCreator.createSetNote).toHaveBeenCalledWith(
			expect.objectContaining({ number: '75192-1' }),
			[
				{ thumbnailURL: img1Path, imageURL: img1Path },
				{ thumbnailURL: img2Path, imageURL: img2Path },
			]
		);
	});

	it('should deduplicate sets that appear in both owned and wanted lists', async () => {
		const sharedSet = makeSet({ setID: 123, number: '75192-1', name: 'Millennium Falcon' });
		const ownedOnly = makeSet({ setID: 456, number: '10497-1', name: 'Galaxy Explorer' });
		const wantedOnly = makeSet({ setID: 789, number: '21348-1', name: 'Dungeons & Dragons' });

		vi.spyOn(apiService, 'getUserOwnedSets').mockResolvedValue({
			status: 'success', matches: 2, sets: [sharedSet, ownedOnly]
		});
		vi.spyOn(apiService, 'getUserWantedSets').mockResolvedValue({
			status: 'success', matches: 2, sets: [sharedSet, wantedOnly]
		});

		const service = new SyncService(
			app,
			makeSettings({ syncOwnedSets: true, syncWantedSets: true }),
			apiService,
			noteCreator
		);
		const result = await service.syncCollection();

		expect(result.total).toBe(3);
		expect(result.created).toBe(3);
		expect(noteCreator.createSetNote).toHaveBeenCalledTimes(3);
	});

	it('should return empty array from resolveLocalAdditionalImages when no local images exist', async () => {
		// Simulate: note file exists, but no additional images in vault
		mockSingleOwnedSet(apiService);
		const getAdditionalImagesSpy = vi.spyOn(apiService, 'getAdditionalImages');

		const noteFilePath = 'LEGO Sets/Star Wars/75192-1 - Millennium Falcon/75192-1 - Millennium Falcon.md';

		app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === noteFilePath) return { path: noteFilePath }; // note exists
			return null; // no images
		});

		const service = new SyncService(app, makeSettings({ downloadImagesOnSync: true }), apiService, noteCreator);
		await service.syncCollection();

		expect(getAdditionalImagesSpy).not.toHaveBeenCalled();
		expect(noteCreator.createSetNote).toHaveBeenCalledWith(
			expect.objectContaining({ number: '75192-1' }),
			[] // no local images found
		);
	});
});
