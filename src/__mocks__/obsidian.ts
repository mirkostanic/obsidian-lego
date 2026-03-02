/// <reference types="vitest/globals" />
/**
 * Mock for the Obsidian API
 * Used in unit tests to avoid requiring the actual Obsidian environment
 */
import { vi } from 'vitest';

export const normalizePath = (path: string): string => {
	// Normalize path separators and remove double slashes
	return path.replaceAll('\\', '/').replaceAll(/\/+/g, '/').replaceAll(/\/$/g, '');
};

export class Notice {
	constructor(public message: string, public timeout?: number) {}
}

export class TFile {
	constructor(
		public path: string,
		public name: string = path.split('/').pop() || '',
		public basename: string = name.replace(/\.[^.]+$/, ''),
		public extension: string = name.split('.').pop() || ''
	) {}
}

export class TFolder {
	constructor(
		public path: string,
		public name: string = path.split('/').pop() || ''
	) {}
}

export class TAbstractFile {
	constructor(public path: string) {}
}

export const requestUrl = vi.fn().mockResolvedValue({
	status: 200,
	text: '{"status":"success"}',
	json: { status: 'success' },
	arrayBuffer: new ArrayBuffer(0)
});

export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

// Mock App
export class App {
	vault = {
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
	};
	metadataCache = {
		on: vi.fn().mockReturnValue({ id: 'mock-event-ref' }),
		off: vi.fn(),
		offref: vi.fn(),
		getFileCache: vi.fn().mockReturnValue(null)
	};
	fileManager = {
		processFrontMatter: vi.fn().mockResolvedValue(undefined)
	};
}
