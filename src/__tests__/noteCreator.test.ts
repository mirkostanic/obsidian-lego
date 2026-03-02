import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoteCreator, sanitizeFileName } from '../noteCreator';
import { FailedSetEntry } from '../types';

// Mock obsidian
vi.mock('obsidian', async (importOriginal) => {
	const original = await importOriginal<Record<string, unknown>>();
	return {
		...original,
		Notice: class { constructor(public message: string) {} },
		normalizePath: (p: string) => p,
		requestUrl: vi.fn(),
	};
});

// We need to expose the private methods for testing
// This is a common pattern - create a test subclass
class TestableNoteCreator extends NoteCreator {
	public testSanitizeTag(tag: string): string {
		return (this as any).sanitizeTag(tag);
	}

	public testEscapeYaml(value: string): string {
		return (this as any).escapeYaml(value);
	}

	public testGetCurrencySymbol(region: string): string {
		return (this as any).getCurrencySymbol(region);
	}
}

describe('NoteCreator', () => {
	let creator: TestableNoteCreator;

	beforeEach(() => {
		const mockApp = {} as any;
		creator = new TestableNoteCreator(mockApp, 'LEGO Sets');
	});

	describe('sanitizeFileName()', () => {
		it('should replace invalid characters with underscores', () => {
			expect(sanitizeFileName(String.raw`test\file`)).toBe('test_file');
			expect(sanitizeFileName('test/file')).toBe('test_file');
			expect(sanitizeFileName('test:file')).toBe('test_file');
			expect(sanitizeFileName('test*file')).toBe('test_file');
			expect(sanitizeFileName('test?file')).toBe('test_file');
			expect(sanitizeFileName('test"file')).toBe('test_file');
			expect(sanitizeFileName('test<file')).toBe('test_file');
			expect(sanitizeFileName('test>file')).toBe('test_file');
			expect(sanitizeFileName('test|file')).toBe('test_file');
		});

		it('should handle multiple invalid characters', () => {
			expect(sanitizeFileName(String.raw`test\/:*?"<>|file`)).toBe('test_________file');
		});

		it('should leave valid characters unchanged', () => {
			expect(sanitizeFileName('test-file_123.txt')).toBe('test-file_123.txt');
			expect(sanitizeFileName('LEGO Set 12345')).toBe('LEGO Set 12345');
		});

		it('should handle empty string', () => {
			expect(sanitizeFileName('')).toBe('');
		});
	});

	describe('sanitizeTag()', () => {
		it('should convert to lowercase', () => {
			expect(creator.testSanitizeTag('Star Wars')).toBe('star-wars');
			expect(creator.testSanitizeTag('FRIENDS')).toBe('friends');
		});

		it('should replace spaces with hyphens', () => {
			expect(creator.testSanitizeTag('Harry Potter')).toBe('harry-potter');
			expect(creator.testSanitizeTag('The Lord of the Rings')).toBe('the-lord-of-the-rings');
		});

		it('should remove special characters', () => {
			expect(creator.testSanitizeTag('Star Wars™')).toBe('star-wars');
			expect(creator.testSanitizeTag('LEGO® City')).toBe('lego-city');
			expect(creator.testSanitizeTag('Friends: Heartlake')).toBe('friends-heartlake');
		});

		it('should replace multiple spaces with single hyphen', () => {
			expect(creator.testSanitizeTag('Star    Wars')).toBe('star-wars');
		});

		it('should remove leading and trailing hyphens', () => {
			expect(creator.testSanitizeTag('-Star Wars-')).toBe('star-wars');
			expect(creator.testSanitizeTag('---test---')).toBe('test');
		});

		it('should handle empty string', () => {
			expect(creator.testSanitizeTag('')).toBe('');
		});

		it('should handle strings with only special characters', () => {
			expect(creator.testSanitizeTag('™®©')).toBe('');
		});

		it('should preserve numbers', () => {
			expect(creator.testSanitizeTag('LEGO 2023')).toBe('lego-2023');
		});
	});

	describe('escapeYaml()', () => {
		it('should escape double quotes', () => {
			expect(creator.testEscapeYaml('test "quoted" text')).toBe(String.raw`test \"quoted\" text`);
		});

		it('should handle multiple quotes', () => {
			expect(creator.testEscapeYaml('"test" "value"')).toBe(String.raw`\"test\" \"value\"`);
		});

		it('should leave text without quotes unchanged', () => {
			expect(creator.testEscapeYaml('test value')).toBe('test value');
		});

		it('should handle empty string', () => {
			expect(creator.testEscapeYaml('')).toBe('');
		});

		it('should handle string with only quotes', () => {
			expect(creator.testEscapeYaml('"""')).toBe(String.raw`\"\"\"`);
		});
	});

	describe('Real-world examples', () => {
		it('should handle typical LEGO theme names', () => {
			expect(creator.testSanitizeTag('Star Wars')).toBe('star-wars');
			expect(creator.testSanitizeTag('Friends')).toBe('friends');
			expect(creator.testSanitizeTag('Harry Potter')).toBe('harry-potter');
			expect(creator.testSanitizeTag('NINJAGO®')).toBe('ninjago');
			expect(creator.testSanitizeTag('The Lord of the Rings™')).toBe('the-lord-of-the-rings');
		});

		it('should handle typical subtheme names', () => {
			expect(creator.testSanitizeTag('Heartlake City')).toBe('heartlake-city');
			expect(creator.testSanitizeTag('The Skywalker Saga')).toBe('the-skywalker-saga');
			expect(creator.testSanitizeTag('Hogwarts™')).toBe('hogwarts');
		});

		it('should handle set names with special characters', () => {
			expect(sanitizeFileName('41058 - Heartlake Shopping Mall')).toBe('41058 - Heartlake Shopping Mall');
			expect(sanitizeFileName('75192 - Millennium Falcon™')).toBe('75192 - Millennium Falcon™');
		});

		it('should escape YAML values with quotes', () => {
			expect(creator.testEscapeYaml('The "Ultimate" Set')).toBe(String.raw`The \"Ultimate\" Set`);
			expect(creator.testEscapeYaml('Friends: Emma\'s "Art Café"')).toBe(String.raw`Friends: Emma's \"Art Café\"`);
		});
	});
});

describe('NoteCreator - getCurrencySymbol() (line 554)', () => {
	let creator: TestableNoteCreator;

	beforeEach(() => {
		creator = new TestableNoteCreator({} as any, 'LEGO Sets');
	});

	it('should return $ for US', () => {
		expect(creator.testGetCurrencySymbol('US')).toBe('$');
	});

	it('should return £ for UK', () => {
		expect(creator.testGetCurrencySymbol('UK')).toBe('£');
	});

	it('should return CA$ for CA', () => {
		expect(creator.testGetCurrencySymbol('CA')).toBe('CA$');
	});

	it('should return € for DE', () => {
		expect(creator.testGetCurrencySymbol('DE')).toBe('€');
	});

	it('should return $ as fallback for unknown region (line 554 || branch)', () => {
		expect(creator.testGetCurrencySymbol('FR')).toBe('$');
		expect(creator.testGetCurrencySymbol('AU')).toBe('$');
		expect(creator.testGetCurrencySymbol('')).toBe('$');
	});
});

// ---------------------------------------------------------------------------
// writeSyncLog()
// ---------------------------------------------------------------------------

describe('NoteCreator - writeSyncLog()', () => {
	let mockVault: {
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		modify: ReturnType<typeof vi.fn>;
		createFolder: ReturnType<typeof vi.fn>;
		createBinary: ReturnType<typeof vi.fn>;
	};
	let creator: NoteCreator;

	/** Fixed timestamp: 2024-06-15 10:30:00 UTC */
	const FIXED_TS = new Date('2024-06-15T10:30:00Z').getTime();

	beforeEach(() => {
		mockVault = {
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			create: vi.fn().mockResolvedValue(undefined),
			modify: vi.fn().mockResolvedValue(undefined),
			createFolder: vi.fn().mockResolvedValue(undefined),
			createBinary: vi.fn().mockResolvedValue(undefined),
		};
		creator = new NoteCreator({ vault: mockVault } as any, 'LEGO Sets');
	});

	it('should write a success message when no sets failed', async (): Promise<void> => {
		await creator.writeSyncLog([], FIXED_TS);

		expect(mockVault.create).toHaveBeenCalledOnce();
		const content: string = mockVault.create.mock.calls[0][1];
		expect(content).toContain('2024-06-15 10:30:00 UTC');
		expect(content).toContain('✅ All sets synced successfully.');
		expect(content).not.toContain('⚠️');
	});

	it('should write a failure table with singular wording for one failed set', async (): Promise<void> => {
		const failed: FailedSetEntry[] = [
			{ setNumber: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', error: 'Network timeout' },
		];

		await creator.writeSyncLog(failed, FIXED_TS);

		expect(mockVault.create).toHaveBeenCalledOnce();
		const content: string = mockVault.create.mock.calls[0][1];
		expect(content).toContain('⚠️ **1 set failed to sync:**');
		expect(content).toContain('| 75192-1 | Millennium Falcon | Star Wars | Network timeout |');
		expect(content).not.toContain('sets failed');
	});

	it('should write a failure table with plural wording for multiple failed sets', async (): Promise<void> => {
		const failed: FailedSetEntry[] = [
			{ setNumber: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', error: 'Error A' },
			{ setNumber: '10179-1', name: 'UCS Millennium Falcon', theme: 'Star Wars', error: 'Error B' },
		];

		await creator.writeSyncLog(failed, FIXED_TS);

		const content: string = mockVault.create.mock.calls[0][1];
		expect(content).toContain('⚠️ **2 sets failed to sync:**');
		expect(content).toContain('| 75192-1 | Millennium Falcon | Star Wars | Error A |');
		expect(content).toContain('| 10179-1 | UCS Millennium Falcon | Star Wars | Error B |');
	});

	it('should escape pipe characters in error messages', async (): Promise<void> => {
		const failed: FailedSetEntry[] = [
			{ setNumber: '75192-1', name: 'Falcon', theme: 'Star Wars', error: 'Error: foo | bar' },
		];

		await creator.writeSyncLog(failed, FIXED_TS);

		const content: string = mockVault.create.mock.calls[0][1];
		expect(content).toContain(String.raw`Error: foo \| bar`);
	});

	it('should overwrite an existing log file', async (): Promise<void> => {
		const { TFile } = await import('obsidian');
		const existingFile = Object.create(TFile.prototype);
		mockVault.getAbstractFileByPath.mockReturnValue(existingFile);

		await creator.writeSyncLog([], FIXED_TS);

		expect(mockVault.modify).toHaveBeenCalledOnce();
		expect(mockVault.create).not.toHaveBeenCalled();
	});

	it('should write the log to LEGO Sets/sync-log.md', async (): Promise<void> => {
		await creator.writeSyncLog([], FIXED_TS);

		const path: string = mockVault.create.mock.calls[0][0];
		expect(path).toBe('LEGO Sets/sync-log.md');
	});
});
