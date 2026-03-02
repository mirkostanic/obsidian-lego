import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BricksetApiService, BricksetApiError } from '../bricksetApi';

// Mock the requestUrl function from obsidian
vi.mock('obsidian', () => ({
	requestUrl: vi.fn()
}));

import { requestUrl } from 'obsidian';
const mockRequestUrl = vi.mocked(requestUrl);

describe('BricksetApiService', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	describe('constructor and basic methods', () => {
		it('should initialize with apiKey and userHash', () => {
			expect(service.isAuthenticated()).toBe(true);
			expect(service.getUserHash()).toBe('test-user-hash');
		});

		it('should initialize without userHash', () => {
			const unauthService = new BricksetApiService('test-api-key');
			expect(unauthService.isAuthenticated()).toBe(false);
			expect(unauthService.getUserHash()).toBeUndefined();
		});

		it('should set userHash', () => {
			const unauthService = new BricksetApiService('test-api-key');
			unauthService.setUserHash('new-hash');
			expect(unauthService.isAuthenticated()).toBe(true);
			expect(unauthService.getUserHash()).toBe('new-hash');
		});
	});

	describe('validateKey()', () => {
		it('should return true when API key is valid', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success"}',
				json: { status: 'success' }
			} as any);

			const result = await service.validateKey();
			expect(result).toBe(true);
		});

		it('should return false when API key is invalid', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"error","message":"Invalid API key"}',
				json: { status: 'error', message: 'Invalid API key' }
			} as any);

			const result = await service.validateKey();
			expect(result).toBe(false);
		});

		it('should return false on HTTP error (catches internally)', async () => {
			mockRequestUrl.mockRejectedValue(new Error('Network error'));

			const result = await service.validateKey();
			expect(result).toBe(false);
		});
	});

	describe('login()', () => {
		it('should return userHash on successful login', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success","hash":"abc123"}',
				json: { status: 'success', hash: 'abc123' }
			} as any);

			const hash = await service.login('user@example.com', 'password');
			expect(hash).toBe('abc123');
		});

		it('should throw BricksetApiError on failed login', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"error","message":"Invalid credentials"}',
				json: { status: 'error', message: 'Invalid credentials' }
			} as any);

			await expect(service.login('user@example.com', 'wrong')).rejects.toThrow(BricksetApiError);
		});
	});

	describe('setUserFlags()', () => {
		it('should call setCollection with correct URL format', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success"}',
				json: { status: 'success' }
			} as any);

			const result = await service.setUserFlags(23351, { own: true, want: false });

			expect(result).toBe(true);
			expect(mockRequestUrl).toHaveBeenCalledOnce();

			const callArg = mockRequestUrl.mock.calls[0][0] as any;
			expect(callArg.url).toContain('setCollection');
			expect(callArg.url).toContain('SetID=23351');
			expect(callArg.url).toContain('params=');
		});

		it('should include own=1 when own is true', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success"}',
				json: { status: 'success' }
			} as any);

			await service.setUserFlags(23351, { own: true });

			const callArg = mockRequestUrl.mock.calls[0][0] as any;
			const paramsStr = decodeURIComponent(callArg.url.split('params=')[1]);
			const params = JSON.parse(paramsStr);
			expect(params.own).toBe(1);
		});

		it('should include own=0 when own is false', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success"}',
				json: { status: 'success' }
			} as any);

			await service.setUserFlags(23351, { own: false });

			const callArg = mockRequestUrl.mock.calls[0][0] as any;
			const paramsStr = decodeURIComponent(callArg.url.split('params=')[1]);
			const params = JSON.parse(paramsStr);
			expect(params.own).toBe(0);
		});

		it('should clamp qtyOwned to 0-999 range', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success"}',
				json: { status: 'success' }
			} as any);

			await service.setUserFlags(23351, { qtyOwned: 9999 });

			const callArg = mockRequestUrl.mock.calls[0][0] as any;
			const paramsStr = decodeURIComponent(callArg.url.split('params=')[1]);
			const params = JSON.parse(paramsStr);
			expect(params.qtyOwned).toBe(999);
		});

		it('should clamp qtyOwned minimum to 0', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success"}',
				json: { status: 'success' }
			} as any);

			await service.setUserFlags(23351, { qtyOwned: -5 });

			const callArg = mockRequestUrl.mock.calls[0][0] as any;
			const paramsStr = decodeURIComponent(callArg.url.split('params=')[1]);
			const params = JSON.parse(paramsStr);
			expect(params.qtyOwned).toBe(0);
		});

		it('should clamp rating to 1-5 range', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success"}',
				json: { status: 'success' }
			} as any);

			await service.setUserFlags(23351, { rating: 10 });

			const callArg = mockRequestUrl.mock.calls[0][0] as any;
			const paramsStr = decodeURIComponent(callArg.url.split('params=')[1]);
			const params = JSON.parse(paramsStr);
			expect(params.rating).toBe(5);
		});

		it('should truncate notes to 1000 characters', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"success"}',
				json: { status: 'success' }
			} as any);

			const longNotes = 'a'.repeat(1500);
			await service.setUserFlags(23351, { notes: longNotes });

			const callArg = mockRequestUrl.mock.calls[0][0] as any;
			const paramsStr = decodeURIComponent(callArg.url.split('params=')[1]);
			const params = JSON.parse(paramsStr);
			expect(params.notes.length).toBe(1000);
		});

		it('should throw BricksetApiError on HTTP 500', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 500,
				text: 'Internal Server Error'
			} as any);

			await expect(service.setUserFlags(23351, { own: true })).rejects.toThrow(BricksetApiError);
		});

		it('should throw BricksetApiError when not authenticated', async () => {
			const unauthService = new BricksetApiService('test-api-key');
			await expect(unauthService.setUserFlags(23351, { own: true })).rejects.toThrow(BricksetApiError);
		});

		it('should throw BricksetApiError when API returns error status', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				text: '{"status":"error","message":"Set not found"}',
				json: { status: 'error', message: 'Set not found' }
			} as any);

			await expect(service.setUserFlags(23351, { own: true })).rejects.toThrow(BricksetApiError);
		});
	});

	describe('BricksetApiError', () => {
		it('should have correct name', () => {
			const error = new BricksetApiError('test message');
			expect(error.name).toBe('BricksetApiError');
		});

		it('should store statusCode and apiStatus', () => {
			const error = new BricksetApiError('test', 404, 'not_found');
			expect(error.statusCode).toBe(404);
			expect(error.apiStatus).toBe('not_found');
		});

		it('should be instanceof Error', () => {
			const error = new BricksetApiError('test');
			expect(error).toBeInstanceOf(Error);
		});
	});
});

describe('BricksetApiService - login() network error', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key');
		vi.clearAllMocks();
	});

	it('should throw wrapped BricksetApiError on network error (non-BricksetApiError)', async () => {
		// Throw a plain Error (not BricksetApiError) to hit line 102
		mockRequestUrl.mockRejectedValue(new Error('Connection refused'));

		await expect(service.login('user@example.com', 'password')).rejects.toThrow(BricksetApiError);
		await expect(service.login('user@example.com', 'password')).rejects.toThrow('Login failed: Connection refused');
	});
});

describe('BricksetApiService - getUserOwnedSets() error paths', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should throw BricksetApiError when API returns error status (line 187)', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { status: 'error', message: 'Unauthorized' }
		} as any);

		await expect(service.getUserOwnedSets()).rejects.toThrow(BricksetApiError);
		await expect(service.getUserOwnedSets()).rejects.toThrow('Unauthorized');
	});

	it('should throw wrapped BricksetApiError on network error (line 196)', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Connection refused'));

		await expect(service.getUserOwnedSets()).rejects.toThrow(BricksetApiError);
		await expect(service.getUserOwnedSets()).rejects.toThrow('Failed to fetch owned sets: Connection refused');
	});

	it('should re-throw BricksetApiError without double-wrapping (line 194)', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 401,
			json: { status: 'error', message: 'Invalid hash' }
		} as any);

		const err = await service.getUserOwnedSets().catch(e => e);
		expect(err).toBeInstanceOf(BricksetApiError);
		expect(err.message).not.toContain('Failed to fetch owned sets: Failed to fetch owned sets');
	});
});
