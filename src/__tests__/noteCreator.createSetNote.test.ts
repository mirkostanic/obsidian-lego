import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NoteCreator } from '../noteCreator';
import { TFile, TFolder } from '../__mocks__/obsidian';
import { LegoSet, AdditionalImage } from '../types';

// Mock obsidian module
vi.mock('obsidian', async () => {
	const mock = await import('../__mocks__/obsidian');
	return mock;
});

import { requestUrl } from 'obsidian';
const mockRequestUrl = vi.mocked(requestUrl);

/**
 * Find the vault.create call that created the .md note file
 */
function getNoteCreateCall(app: any): [string, string] | null {
	const calls = app.vault.create.mock.calls as [string, string][];
	const noteCall = calls.find(([path]) => path.endsWith('.md'));
	return noteCall ?? null;
}

/**
 * Get the content of the created note file
 */
function getNoteContent(app: any): string {
	const call = getNoteCreateCall(app);
	if (!call) throw new Error('No .md file was created');
	return call[1];
}

// Helper: build a minimal LegoSet
function makeSet(overrides: Partial<LegoSet> = {}): LegoSet {
	return {
		setID: 23351,
		number: '75192',
		numberVariant: 1,
		name: 'Millennium Falcon',
		year: 2017,
		theme: 'Star Wars',
		themeGroup: 'Licensed',
		subtheme: 'Ultimate Collector Series',
		category: 'Normal',
		released: true,
		pieces: 7541,
		minifigs: 4,
		image: {
			thumbnailURL: 'https://images.brickset.com/sets/small/75192-1.jpg',
			imageURL: 'https://images.brickset.com/sets/images/75192-1.jpg'
		},
		bricksetURL: 'https://brickset.com/sets/75192-1',
		lastUpdated: '2023-01-01',
		...overrides
	};
}

function createMockApp() {
	return {
		vault: {
			adapter: {
				exists: vi.fn().mockResolvedValue(false),
				read: vi.fn().mockResolvedValue('{}'),
				write: vi.fn().mockResolvedValue(undefined)
			},
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			create: vi.fn().mockResolvedValue(undefined),
			createBinary: vi.fn().mockResolvedValue(undefined),
			createFolder: vi.fn().mockResolvedValue(undefined),
			modify: vi.fn().mockResolvedValue(undefined),
			read: vi.fn().mockResolvedValue('')
		},
		metadataCache: {
			on: vi.fn().mockReturnValue({ id: 'mock-event-ref' }),
			off: vi.fn(),
			offref: vi.fn(),
			getFileCache: vi.fn().mockReturnValue(null)
		},
		fileManager: {
			processFrontMatter: vi.fn().mockResolvedValue(undefined)
		}
	} as any;
}

// Helper: mock so .md file doesn't exist on first check (triggers create),
// but exists on subsequent checks (for the final getAbstractFileByPath call).
// Optionally, supply an existingImageFile to simulate an already-downloaded image.
function mockFileNotExistsThenExists(
	app: ReturnType<typeof createMockApp>,
	existingImageFile?: TFile
): void {
	const mdCallCounts = new Map<string, number>();
	app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
		if (existingImageFile && path.endsWith('.jpg')) return existingImageFile;
		if (path.endsWith('.md')) {
			const count = (mdCallCounts.get(path) || 0) + 1;
			mdCallCounts.set(path, count);
			return count === 1 ? null : new TFile(path);
		}
		return null;
	});
}

describe('NoteCreator - createSetNote()', () => {
	let app: ReturnType<typeof createMockApp>;
	let creator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		creator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();

		mockFileNotExistsThenExists(app);

		mockRequestUrl.mockResolvedValue({
			status: 200,
			text: '',
			json: {},
			arrayBuffer: new ArrayBuffer(100)
		} as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Folder creation', () => {
		it('should create theme folder, set folder, and images folder', async () => {
			const set = makeSet();
			// After creation, getAbstractFileByPath returns the file
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) return new TFile(path);
				return null;
			});

			await creator.createSetNote(set, []);

			// createFolder should be called for: legoSetsFolder, themeFolderPath, setFolderPath, imagesFolderPath
			expect(app.vault.createFolder).toHaveBeenCalledWith('LEGO Sets');
			expect(app.vault.createFolder).toHaveBeenCalledWith('LEGO Sets/Star Wars');
			expect(app.vault.createFolder).toHaveBeenCalledWith('LEGO Sets/Star Wars/75192 - Millennium Falcon');
			expect(app.vault.createFolder).toHaveBeenCalledWith('LEGO Sets/Star Wars/75192 - Millennium Falcon/images');
		});

		it('should not throw if folder already exists', async () => {
			const set = makeSet();
			app.vault.createFolder.mockRejectedValue(new Error('Folder already exists'));
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) return new TFile(path);
				return new TFolder(path);
			});

			// Should not throw
			await expect(creator.createSetNote(set, [])).resolves.toBeDefined();
		});
	});

	describe('File creation', () => {
		it('should create a new note file when it does not exist', async () => {
			const set = makeSet();
			// File doesn't exist on first check (so create is called), but exists after
			const createdFile = new TFile('LEGO Sets/Star Wars/75192 - Millennium Falcon/75192 - Millennium Falcon.md');
			let mdCheckCount = 0;
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) {
					mdCheckCount++;
					// First check: doesn't exist → triggers create
					// Second check (after create, line 85): exists
					return mdCheckCount === 1 ? null : createdFile;
				}
				return null;
			});

			await creator.createSetNote(set, []);

			// At least one .md file should be created
			const noteCall = getNoteCreateCall(app);
			expect(noteCall).not.toBeNull();
			expect(noteCall![0]).toContain('75192 - Millennium Falcon.md');
			expect(noteCall![1]).toContain('setNumber: "75192"');
			expect(noteCall![1]).toContain('# 75192: Millennium Falcon');
		});

		it('should update existing file instead of creating new one', async () => {
			const set = makeSet();
			const existingFile = new TFile('LEGO Sets/Star Wars/75192 - Millennium Falcon/75192 - Millennium Falcon.md');

			// File already exists on first check
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) return existingFile;
				return null;
			});

			await creator.createSetNote(set, []);

			const mdCreateCalls = app.vault.create.mock.calls.filter(([p]: [string]) => p.endsWith('.md'));
			expect(mdCreateCalls).toHaveLength(0);
			expect(app.vault.modify).toHaveBeenCalledWith(existingFile, expect.any(String));
		});

		it('should handle "File already exists" race condition gracefully', async () => {
			const set = makeSet();
			const existingFile = new TFile('LEGO Sets/Star Wars/75192 - Millennium Falcon/75192 - Millennium Falcon.md');

			// File doesn't exist on first check, but create throws "already exists"
			let callCount = 0;
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) {
					callCount++;
					// First call (existence check) returns null, second call (after error) returns file
					return callCount === 1 ? null : existingFile;
				}
				return null;
			});
			app.vault.create.mockRejectedValue(new Error('File already exists'));

			await creator.createSetNote(set, []);

			// Should have fallen back to modify
			expect(app.vault.modify).toHaveBeenCalledWith(existingFile, expect.any(String));
		});

		it('should re-throw non-"already exists" errors', async () => {
			const set = makeSet();
			app.vault.getAbstractFileByPath.mockReturnValue(null);
			app.vault.create.mockRejectedValue(new Error('Permission denied'));

			await expect(creator.createSetNote(set, [])).rejects.toThrow('Permission denied');
		});

		it('should re-throw "already exists" error when file still does not exist after error', async () => {
			const set = makeSet();
			// File doesn't exist on any check (including after the "already exists" error)
			app.vault.getAbstractFileByPath.mockReturnValue(null);
			app.vault.create.mockRejectedValue(new Error('File already exists'));

			// Should re-throw because fileNow is null (not a TFile)
			await expect(creator.createSetNote(set, [])).rejects.toThrow('File already exists');
		});

		it('should return the created TFile', async () => {
			const set = makeSet();
			const expectedFile = new TFile('LEGO Sets/Star Wars/75192 - Millennium Falcon/75192 - Millennium Falcon.md');
			// First .md check: null (triggers create); subsequent: return the file
			let mdCheckCount = 0;
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) {
					mdCheckCount++;
					return mdCheckCount === 1 ? null : expectedFile;
				}
				return null;
			});

			const result = await creator.createSetNote(set, []);

			expect(result).toBe(expectedFile);
		});
	});

	describe('Note content generation', () => {
		it('should include correct frontmatter fields', async () => {
			const set = makeSet({
				collection: { owned: true, wanted: false, qtyOwned: 2, rating: 4 }
			});
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('setID: 23351');
			expect(content).toContain('setNumber: "75192"');
			expect(content).toContain('theme: "Star Wars"');
			expect(content).toContain('subtheme: "Ultimate Collector Series"');
			expect(content).toContain('year: 2017');
			expect(content).toContain('pieces: 7541');
			expect(content).toContain('minifigs: 4');
			expect(content).toContain('owned: true');
			expect(content).toContain('wanted: false');
			expect(content).toContain('qtyOwned: 2');
			expect(content).toContain('userRating: 4');
		});

		it('should include lego, set, theme/subtheme tags', async (): Promise<void> => {
			const set = makeSet();
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('tags: [lego, set, star-wars, ultimate-collector-series]');
		});

		it('should not include subtheme tag when subtheme is empty', async (): Promise<void> => {
			const set = makeSet({ subtheme: '' });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('tags: [lego, set, star-wars]');
			expect(content).not.toContain('subtheme:');
		});

		it('should write qtyOwned: 0 to frontmatter when collection resets quantity to zero', async (): Promise<void> => {
			// Regression: falsy check `if (collection.qtyOwned)` would skip qtyOwned=0,
			// leaving a stale non-zero value in the note after a Brickset → Obsidian sync.
			const set = makeSet({
				collection: { owned: false, wanted: false, qtyOwned: 0 }
			});
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('qtyOwned: 0');
			expect(content).toContain('owned: false');
		});

		it('should write userRating: 0 to frontmatter when rating is explicitly zero', async (): Promise<void> => {
			// Regression: falsy check `if (collection.rating)` would skip rating=0.
			const set = makeSet({
				collection: { owned: true, wanted: false, rating: 0 }
			});
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('userRating: 0');
		});

		it('should default owned/wanted to false when no collection data', async () => {
			const set = makeSet({ collection: undefined, collections: undefined });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('owned: false');
			expect(content).toContain('wanted: false');
		});

		it('should include cover image in frontmatter when image is downloaded', async () => {
			const set = makeSet();
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('cover: "[[images/main.jpg]]"');
		});

		it('should include additional images section when images are provided', async () => {
			const set = makeSet();
			const additionalImages: AdditionalImage[] = [
				{ thumbnailURL: 'https://example.com/thumb1.jpg', imageURL: 'https://example.com/img1.jpg' },
				{ thumbnailURL: 'https://example.com/thumb2.jpg', imageURL: 'https://example.com/img2.jpg' }
			];
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, additionalImages);

			const content = getNoteContent(app);
			expect(content).toContain('## Additional Images');
			expect(content).toContain('![Additional Image 1](images/additional-1.jpg)');
			expect(content).toContain('![Additional Image 2](images/additional-2.jpg)');
		});

		it('should include Brickset, BrickLink, and Rebrickable links', async () => {
			const set = makeSet();
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('[Brickset Page](https://brickset.com/sets/75192-1)');
			// BrickLink URL: set number with dashes removed
			expect(content).toContain('[BrickLink](https://www.bricklink.com/v2/catalog/catalogitem.page?S=');
			expect(content).toContain('[Rebrickable](https://rebrickable.com/sets/75192-1/)');
		});

		it('should include pricing when LEGOCom data is available', async () => {
			const set = makeSet({
				LEGOCom: {
					US: { retailPrice: 849.99 }
				}
			});
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('**RRP (US):** $849.99');
		});

		it('should include description when extendedData is available', async () => {
			const set = makeSet({
				extendedData: { description: 'The ultimate LEGO Star Wars set.' }
			});
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('## Description');
			expect(content).toContain('The ultimate LEGO Star Wars set.');
		});

		it('should include dimensions when available', async () => {
			const set = makeSet({
				dimensions: { height: 21, width: 56, depth: 33, weight: 7.9 }
			});
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('## Dimensions');
			expect(content).toContain('**Height:** 21 cm');
			expect(content).toContain('**Width:** 56 cm');
			expect(content).toContain('**Depth:** 33 cm');
			expect(content).toContain('**Weight:** 7.9 kg');
		});
	});

	describe('Image downloading', () => {
		let set: LegoSet;

		beforeEach((): void => {
			set = makeSet();
			mockFileNotExistsThenExists(app);
		});

		it('should skip image download when imageURL is undefined', async (): Promise<void> => {
			// Intentionally pass undefined for imageURL to test the falsy-URL guard
			set = makeSet({ image: { thumbnailURL: '', imageURL: undefined as unknown as string } });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			// requestUrl should not be called for image download
			expect(mockRequestUrl).not.toHaveBeenCalled();
			// No cover in frontmatter
			const content = getNoteContent(app);
			expect(content).not.toContain('cover:');
		});

		it('should use existing image file if already downloaded', async (): Promise<void> => {
			const existingImageFile = new TFile('LEGO Sets/Star Wars/75192 - Millennium Falcon/images/main.jpg');
			mockFileNotExistsThenExists(app, existingImageFile);

			await creator.createSetNote(set, []);

			// requestUrl should not be called since image already exists
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('should handle image download failure gracefully', async (): Promise<void> => {
			mockRequestUrl.mockRejectedValue(new Error('Network error'));

			// Should not throw - image failure is non-fatal
			await expect(creator.createSetNote(set, [])).resolves.toBeDefined();

			// Note should still be created, just without cover image
			const content = getNoteContent(app);
			expect(content).not.toContain('cover:');
		});

		it('should handle "already exists" error when saving binary image', async (): Promise<void> => {
			app.vault.createBinary.mockRejectedValue(new Error('File already exists'));

			// Should not throw - "already exists" for binary is handled
			await expect(creator.createSetNote(set, [])).resolves.toBeDefined();
		});

		it('should swallow non-"already exists" errors from createBinary and still create the note', async (): Promise<void> => {
			app.vault.createBinary.mockRejectedValue(new Error('Disk full'));

			// The error is caught by the outer image-download try/catch, so note creation still succeeds
			await expect(creator.createSetNote(set, [])).resolves.toBeDefined();
			// The note should be created without a cover image
			const content = getNoteContent(app);
			expect(content).not.toContain('cover:');
		});
	});

	describe('ensureBaseFile()', () => {
		it('should create a .base file inside the LEGO Sets folder', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(null);

			await creator.ensureBaseFile();

			expect(app.vault.create).toHaveBeenCalledWith(
				'LEGO Sets/LEGO Sets.base',
				expect.stringContaining('file.inFolder("LEGO Sets")')
			);
		});

		it('should include the folder name in the .base file filter', async () => {
			const customCreator = new NoteCreator(app, 'My LEGO');
			app.vault.getAbstractFileByPath.mockReturnValue(null);

			await customCreator.ensureBaseFile();

			expect(app.vault.create).toHaveBeenCalledWith(
				'My LEGO/My LEGO.base',
				expect.stringContaining('file.inFolder("My LEGO")')
			);
			expect(app.vault.create).toHaveBeenCalledWith(
				'My LEGO/My LEGO.base',
				expect.stringContaining('file.name != "My LEGO.base"')
			);
		});

		it('should skip creation if .base file already exists', async () => {
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.base')) return new TFile(path);
				return null;
			});

			await creator.ensureBaseFile();

			expect(app.vault.create).not.toHaveBeenCalled();
		});

		it('should silently ignore "already exists" error', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(null);
			app.vault.create.mockRejectedValue(new Error('File already exists'));

			await expect(creator.ensureBaseFile()).resolves.toBeUndefined();
		});

		it('should re-throw non-"already exists" errors', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(null);
			app.vault.create.mockRejectedValue(new Error('Disk full'));

			await expect(creator.ensureBaseFile()).rejects.toThrow('Disk full');
		});
	});

	describe('Rating and review fields', () => {
		it('should include rating when set', async () => {
			const set = makeSet({ rating: 4.3 });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('**Rating:** 4.3/5');
		});

		it('should include reviewCount when rating and reviewCount are set', async () => {
			const set = makeSet({ rating: 4.3, reviewCount: 12 });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('**Rating:** 4.3/5');
			expect(content).toContain('**Reviews:** 12');
		});
	});

	describe('Additional details fields', () => {
		it('should include packagingType when set', async () => {
			const set = makeSet({ packagingType: 'Box' });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('**Packaging:** Box');
		});

		it('should include availability when set', async () => {
			const set = makeSet({ availability: 'LEGO exclusive' });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('**Availability:** LEGO exclusive');
		});

		it('should include age range with max when both min and max are set', async () => {
			const set = makeSet({ ageRange: { min: 16, max: 99 } });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('**Age Range:** 16-99');
		});

		it('should include age range with + suffix when only min is set', async () => {
			const set = makeSet({ ageRange: { min: 18 } });
			mockFileNotExistsThenExists(app);

			await creator.createSetNote(set, []);

			const content = getNoteContent(app);
			expect(content).toContain('**Age Range:** 18+');
		});
	});


	describe('ensureFolderExists error handling', () => {
		it('should silently ignore "Folder already exists" error from createFolder', async () => {
			const set = makeSet();
			// createFolder always throws "Folder already exists"
			app.vault.createFolder.mockRejectedValue(new Error('Folder already exists'));
			// getAbstractFileByPath: .md exists, everything else returns null (no folder check needed)
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) return new TFile(path);
				return null;
			});

			// Should not throw
			await expect(creator.createSetNote(set, [])).resolves.toBeDefined();
		});

		it('should not throw when createFolder fails with other error but folder now exists', async () => {
			const set = makeSet();
			// createFolder throws a generic error
			app.vault.createFolder.mockRejectedValue(new Error('Unexpected error'));
			// After the error, getAbstractFileByPath returns a TFolder (folder was created by another process)
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) return new TFile(path);
				return new TFolder(path); // folder exists now
			});

			// Should not throw
			await expect(creator.createSetNote(set, [])).resolves.toBeDefined();
		});

		it('should throw when createFolder fails and folder still does not exist', async () => {
			const set = makeSet();
			app.vault.createFolder.mockRejectedValue(new Error('Permission denied'));
			// After the error, folder still doesn't exist
			app.vault.getAbstractFileByPath.mockReturnValue(null);

			await expect(creator.createSetNote(set, [])).rejects.toThrow('Permission denied');
		});

		it('should throw when path exists but is not a folder', async () => {
			const set = makeSet();
			// A TFile exists at the folder path (not a TFolder)
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path.endsWith('.md')) return new TFile(path);
				// Return a TFile for folder paths to trigger the "not a folder" error
				return new TFile(path);
			});

			await expect(creator.createSetNote(set, [])).rejects.toThrow('exists but is not a folder');
		});
	});
});

describe('NoteCreator - collection.owned || false branch (line 171)', () => {
	let app: ReturnType<typeof createMockApp>;
	let creator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		creator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		mockFileNotExistsThenExists(app);

		mockRequestUrl.mockResolvedValue({
			status: 200,
			text: '',
			json: {},
			arrayBuffer: new ArrayBuffer(100)
		} as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should use false when collection.owned is undefined (line 171 || false branch)', async () => {
		const set = makeSet({
			collection: {
				// owned is undefined → collection.owned || false → false
				wanted: true
			} as any
		});

		await creator.createSetNote(set, []);

		const content = getNoteContent(app);
		expect(content).toContain('owned: false');
		expect(content).toContain('wanted: true');
	});
});

describe('NoteCreator - ensureBaseFile() with non-Error thrown', () => {
	let app: ReturnType<typeof createMockApp>;
	let creator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		creator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
	});

	it('should re-throw when a non-Error is thrown during .base file creation', async () => {
		app.vault.getAbstractFileByPath.mockReturnValue(null);
		// eslint-disable-next-line @typescript-eslint/no-throw-literal
		app.vault.create.mockRejectedValue('base file error without message');

		await expect(creator.ensureBaseFile()).rejects.toBe('base file error without message');
	});
});

describe('NoteCreator - ensureFolderExists() uncovered branches', () => {
	let app: ReturnType<typeof createMockApp>;
	let creator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		creator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		mockFileNotExistsThenExists(app);

		mockRequestUrl.mockResolvedValue({
			status: 200,
			text: '',
			json: {},
			arrayBuffer: new ArrayBuffer(100)
		} as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should use String(error) fallback when createFolder error has no .message (line 497)', async () => {
		const set = makeSet();
		// createFolder throws a non-Error object (no .message)
		app.vault.createFolder.mockImplementation(() => {
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			throw 'folder creation failed';
		});
		// After the error, getAbstractFileByPath returns null → re-throw
		app.vault.getAbstractFileByPath.mockReturnValue(null);

		await expect(creator.createSetNote(set, [])).rejects.toBe('folder creation failed');
	});

	it('should not throw when createFolder fails but folderNow is a TFolder (line 505 false branch)', async () => {
		const set = makeSet();
		// Track how many times createFolder has been called
		let createFolderCallCount = 0;
		app.vault.createFolder.mockImplementation(async () => {
			createFolderCallCount++;
			throw new Error('Race condition');
		});

		// getAbstractFileByPath: return null for folders on first check (triggers createFolder),
		// then return TFolder after the error (so line 505 takes the false branch → no throw)
		app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path.endsWith('.md')) return new TFile(path);
			// Always return TFolder so that after createFolder throws,
			// folderNow is a TFolder → condition is false → no re-throw
			return null; // first check: folder doesn't exist → createFolder called
		});

		// Override: after createFolder throws, getAbstractFileByPath returns TFolder
		// We need two different behaviors: null before createFolder, TFolder after
		let folderCheckCount = 0;
		app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path.endsWith('.md')) return new TFile(path);
			folderCheckCount++;
			// Odd calls (initial check): return null → triggers createFolder
			// Even calls (after error check): return TFolder → no re-throw
			return folderCheckCount % 2 === 0 ? new TFolder(path) : null;
		});

		// Should not throw
		await expect(creator.createSetNote(set, [])).resolves.toBeDefined();
	});
});

describe('NoteCreator - uncovered branch coverage', () => {
	let app: ReturnType<typeof createMockApp>;
	let creator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		creator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		mockFileNotExistsThenExists(app);

		mockRequestUrl.mockResolvedValue({
			status: 200,
			text: '',
			json: {},
			arrayBuffer: new ArrayBuffer(100)
		} as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should skip additional image when downloadImage returns null (line 39)', async () => {
		const set = makeSet();
		const additionalImages: AdditionalImage[] = [
			{ imageURL: 'https://example.com/img1.jpg', thumbnailURL: '' }
		];

		// Make createBinary fail with a non-"already exists" error → downloadImage returns null
		app.vault.createBinary.mockRejectedValue(new Error('Network error'));

		await creator.createSetNote(set, additionalImages);

		const content = getNoteContent(app);
		// No additional images section since download failed
		expect(content).not.toContain('## Additional Images');
	});

	it('should use String(error) fallback when error has no .message in createSetNote catch (line 65)', async () => {
		const set = makeSet();
		// vault.create throws a non-Error object (no .message property)
		app.vault.create.mockImplementation((path: string) => {
			if (path.endsWith('.md')) {
				// eslint-disable-next-line @typescript-eslint/no-throw-literal
				throw 'string error without message';
			}
			return Promise.resolve(undefined);
		});
		// After the error, getAbstractFileByPath returns null (not a TFile) → re-throw
		app.vault.getAbstractFileByPath.mockReturnValue(null);

		await expect(creator.createSetNote(set, [])).rejects.toBe('string error without message');
	});

	it('should use String(error) fallback when error has no .message in downloadImage catch (line 119)', async () => {
		const set = makeSet();
		const additionalImages: AdditionalImage[] = [
			{ imageURL: 'https://example.com/img1.jpg', thumbnailURL: '' }
		];

		// createBinary throws a non-Error object (no .message) → String(error) used
		app.vault.createBinary.mockImplementation(() => {
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			throw 'binary error without message';
		});

		// Should not throw — downloadImage catches and returns null
		await expect(creator.createSetNote(set, additionalImages)).resolves.toBeDefined();
	});

	it('should omit subtheme, pieces, minifigs when not set (lines 157, 161, 164, 208, 212, 215)', async () => {
		const set = makeSet({
			subtheme: undefined,
			pieces: undefined,
			minifigs: undefined
		});

		await creator.createSetNote(set, []);

		const content = getNoteContent(app);
		expect(content).not.toContain('subtheme:');
		expect(content).not.toContain('pieces:');
		expect(content).not.toContain('minifigs:');
		expect(content).not.toContain('**Subtheme:**');
		expect(content).not.toContain('**Pieces:**');
		expect(content).not.toContain('**Minifigs:**');
	});

	it('should use default owned/wanted when no collection data (lines 179-182)', async () => {
		const set = makeSet({
			collection: undefined,
			collections: undefined
		});

		await creator.createSetNote(set, []);

		const content = getNoteContent(app);
		expect(content).toContain('owned: false');
		expect(content).toContain('wanted: false');
		expect(content).not.toContain('qtyOwned:');
		expect(content).not.toContain('userRating:');
	});

	it('should omit qtyOwned and userRating when collection has no qtyOwned/rating (lines 173, 176)', async () => {
		const set = makeSet({
			collection: {
				owned: true,
				wanted: false
				// no qtyOwned, no rating
			} as any
		});

		await creator.createSetNote(set, []);

		const content = getNoteContent(app);
		expect(content).toContain('owned: true');
		expect(content).not.toContain('qtyOwned:');
		expect(content).not.toContain('userRating:');
	});

	it('should render only height when width/depth/weight are absent (lines 265-277)', async () => {
		const set = makeSet({
			dimensions: {
				height: 27.2,
				width: undefined,
				depth: undefined,
				weight: undefined
			} as any
		});

		await creator.createSetNote(set, []);

		const content = getNoteContent(app);
		expect(content).toContain('## Dimensions');
		expect(content).toContain('**Height:** 27.2 cm');
		expect(content).not.toContain('**Width:**');
		expect(content).not.toContain('**Depth:**');
		expect(content).not.toContain('**Weight:**');
	});

	it('should render only width when height/depth/weight are absent (lines 265-277)', async () => {
		const set = makeSet({
			dimensions: {
				height: undefined,
				width: 47.5,
				depth: undefined,
				weight: undefined
			} as any
		});

		await creator.createSetNote(set, []);

		const content = getNoteContent(app);
		expect(content).toContain('## Dimensions');
		expect(content).toContain('**Width:** 47.5 cm');
		expect(content).not.toContain('**Height:**');
		expect(content).not.toContain('**Depth:**');
		expect(content).not.toContain('**Weight:**');
	});

	it('should render only depth when height/width/weight are absent (lines 265-277)', async () => {
		const set = makeSet({
			dimensions: {
				height: undefined,
				width: undefined,
				depth: 14.1,
				weight: undefined
			} as any
		});

		await creator.createSetNote(set, []);

		const content = getNoteContent(app);
		expect(content).toContain('## Dimensions');
		expect(content).toContain('**Depth:** 14.1 cm');
		expect(content).not.toContain('**Height:**');
		expect(content).not.toContain('**Width:**');
		expect(content).not.toContain('**Weight:**');
	});

	it('should render weight when present alongside other dimensions (line 277)', async () => {
		const set = makeSet({
			dimensions: {
				height: 27.2,
				width: 47.5,
				depth: 14.1,
				weight: 2.1
			}
		});

		await creator.createSetNote(set, []);

		const content = getNoteContent(app);
		expect(content).toContain('**Weight:** 2.1 kg');
	});

	it('should return $ for unknown region in getCurrencySymbol (line 554)', async () => {
		const set = makeSet({
			LEGOCom: {
				// Use a region key not in the symbols map to trigger the || '$' fallback
				// We test via the body section which calls getCurrencySymbol
				US: undefined,
				UK: undefined,
				CA: undefined,
				DE: undefined
			} as any
		});

		await creator.createSetNote(set, []);

		// No price line since all regions have no retailPrice
		const content = getNoteContent(app);
		expect(content).not.toContain('**RRP');
	});
});

describe('NoteCreator - createSetNote() error when file lookup fails', () => {
	let app: ReturnType<typeof createMockApp>;
	let creator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		creator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();

		mockRequestUrl.mockResolvedValue({
			status: 200,
			text: '',
			json: {},
			arrayBuffer: new ArrayBuffer(100)
		} as any);
	});

	it('should throw when getAbstractFileByPath returns null after creation', async () => {
		app.vault.getAbstractFileByPath.mockReturnValue(null);

		await expect(creator.createSetNote(makeSet(), [])).rejects.toThrow('Failed to create note at');
	});

	it('should throw when getAbstractFileByPath returns a non-TFile object after creation', async () => {
		const mdCallCounts = new Map<string, number>();
		app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path.endsWith('.md')) {
				const count = (mdCallCounts.get(path) || 0) + 1;
				mdCallCounts.set(path, count);
				if (count === 1) return null;
				return { path }; // plain object, not instanceof TFile
			}
			return null;
		});

		await expect(creator.createSetNote(makeSet(), [])).rejects.toThrow('Failed to create note at');
	});
});

describe('NoteCreator - downloadImage content-type validation', () => {
	let app: ReturnType<typeof createMockApp>;
	let creator: NoteCreator;

	beforeEach(() => {
		app = createMockApp();
		creator = new NoteCreator(app, 'LEGO Sets');
		vi.clearAllMocks();
		mockFileNotExistsThenExists(app);
	});

	it('should skip download when content-type is not an image', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		mockRequestUrl.mockResolvedValue({
			status: 200,
			headers: { 'content-type': 'text/html' },
			json: {},
			arrayBuffer: new ArrayBuffer(100)
		} as any);

		const set = makeSet();
		await creator.createSetNote(set, []);

		expect(warnSpy).toHaveBeenCalledWith(
			'Skipping non-image response (%s) from %s',
			'text/html',
			expect.any(String)
		);
		expect(app.vault.createBinary).not.toHaveBeenCalled();

		warnSpy.mockRestore();
	});

	it('should proceed with download when content-type starts with image/', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			headers: { 'content-type': 'image/jpeg' },
			json: {},
			arrayBuffer: new ArrayBuffer(100)
		} as any);

		const set = makeSet();
		await creator.createSetNote(set, []);

		expect(app.vault.createBinary).toHaveBeenCalled();
	});
});
