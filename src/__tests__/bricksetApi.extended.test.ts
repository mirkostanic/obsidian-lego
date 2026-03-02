import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BricksetApiService, BricksetApiError } from '../bricksetApi';
import { LegoSet } from '../types';

// Mock the requestUrl function from obsidian
vi.mock('obsidian', () => ({
	requestUrl: vi.fn()
}));

import { requestUrl } from 'obsidian';
const mockRequestUrl = vi.mocked(requestUrl);

// ---------------------------------------------------------------------------
// HTTP status code constants — avoids magic numbers throughout the test file
// ---------------------------------------------------------------------------
const HTTP_STATUS = {
	OK: 200,
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
} as const;

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

/** Mock a successful API response, optionally merging extra JSON fields. */
function mockSuccessResponse(extra: Record<string, unknown> = {}): void {
	mockRequestUrl.mockResolvedValue({
		status: HTTP_STATUS.OK,
		json: { status: 'success', ...extra }
	} as any);
}

/** Mock an error API response. Omit `message` to exercise fallback branches. */
function mockErrorResponse(message?: string): void {
	mockRequestUrl.mockResolvedValue({
		status: HTTP_STATUS.OK,
		json: { status: 'error', ...(message === undefined ? {} : { message }) }
	} as any);
}

/**
 * Parse the `params` query-string value from the last `requestUrl` call.
 * Useful for asserting what parameters were sent to the API.
 */
function getLastCallParams(): Record<string, unknown> {
	const callUrl = mockRequestUrl.mock.calls[0][0] as any;
	const paramsStr = decodeURIComponent(callUrl.url.split('params=')[1].split('&')[0]);
	return JSON.parse(paramsStr);
}

// ---------------------------------------------------------------------------
// Helper: build a minimal LegoSet response
// ---------------------------------------------------------------------------
function makeSetResponse(overrides: Partial<LegoSet> = {}): LegoSet {
	return {
		setID: 23351,
		number: '75192-1',
		numberVariant: 1,
		name: 'Millennium Falcon',
		year: 2017,
		theme: 'Star Wars',
		themeGroup: 'Licensed',
		subtheme: 'Ultimate Collector Series',
		category: 'Normal',
		released: true,
		pieces: 7541,
		image: {
			thumbnailURL: 'https://images.brickset.com/sets/small/75192-1.jpg',
			imageURL: 'https://images.brickset.com/sets/images/75192-1.jpg'
		},
		bricksetURL: 'https://brickset.com/sets/75192-1',
		lastUpdated: '2023-01-01',
		...overrides
	};
}

describe('BricksetApiService - getSets()', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should return array of sets on success', async () => {
		const sets = [makeSetResponse(), makeSetResponse({ setID: 99999, number: '10179-1', name: 'Millennium Falcon (2007)' })];
		mockSuccessResponse({ matches: 2, sets });

		const result = await service.getSets({ setNumber: '75192' });

		expect(result).toHaveLength(2);
		expect(result[0].setID).toBe(23351);
		expect(result[1].setID).toBe(99999);
	});

	it('should return empty array when sets is undefined in response', async () => {
		mockSuccessResponse({ matches: 0 });

		const result = await service.getSets({ setNumber: '99999' });

		expect(result).toEqual([]);
	});

	it('should include userHash in URL when authenticated', async () => {
		mockSuccessResponse({ matches: 0, sets: [] });

		await service.getSets({ theme: 'Friends' });

		const callUrl = mockRequestUrl.mock.calls[0][0] as any;
		expect(callUrl.url).toContain('userHash=test-user-hash');
	});

	it('should NOT include userHash in URL when not authenticated', async () => {
		const unauthService = new BricksetApiService('test-api-key');
		mockSuccessResponse({ matches: 0, sets: [] });

		await unauthService.getSets({ theme: 'Friends' });

		const callUrl = mockRequestUrl.mock.calls[0][0] as any;
		expect(callUrl.url).not.toContain('userHash');
	});

	it('should encode params as JSON in URL', async () => {
		mockSuccessResponse({ matches: 0, sets: [] });

		await service.getSets({ theme: 'Star Wars', year: '2023', pageSize: '20' });

		const params = getLastCallParams();
		expect(params.theme).toBe('Star Wars');
		expect(params.year).toBe('2023');
		expect(params.pageSize).toBe('20');
	});

	it('should throw BricksetApiError when API returns error status', async () => {
		mockErrorResponse('Invalid API key');

		const err = await service.getSets({ theme: 'Friends' }).catch(e => e);
		expect(err).toBeInstanceOf(BricksetApiError);
		expect(err.message).toBe('Invalid API key');
	});

	it('should throw BricksetApiError on network error', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Network timeout'));

		const err = await service.getSets({ theme: 'Friends' }).catch(e => e);
		expect(err).toBeInstanceOf(BricksetApiError);
		expect(err.message).toBe('Failed to fetch sets: Network timeout');
	});

	it('should re-throw BricksetApiError without double-wrapping', async () => {
		mockErrorResponse('Original error');

		const err = await service.getSets({ theme: 'Friends' }).catch(e => e);
		expect(err).toBeInstanceOf(BricksetApiError);
		expect(err.message).not.toContain('Failed to fetch sets: Failed to fetch sets');
	});
});

describe('BricksetApiService - getSetByNumber()', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should return the set when found by exact number', async () => {
		const set = makeSetResponse({ number: '75192-1' });
		mockSuccessResponse({ matches: 1, sets: [set] });

		const result = await service.getSetByNumber('75192-1');

		expect(result.setID).toBe(23351);
		expect(result.number).toBe('75192-1');
	});

	it('should try adding -1 suffix when no results found without variant', async () => {
		const set = makeSetResponse({ number: '75192-1' });
		// First call (exact): no results; second call (with -1): found
		mockRequestUrl
			.mockResolvedValueOnce({
				status: 200,
				json: { status: 'success', matches: 0, sets: [] }
			} as any)
			.mockResolvedValueOnce({
				status: 200,
				json: { status: 'success', matches: 1, sets: [set] }
			} as any);

		const result = await service.getSetByNumber('75192');

		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		expect(result.number).toBe('75192-1');
	});

	it('should NOT retry with -1 when number already contains a dash', async () => {
		mockSuccessResponse({ matches: 0, sets: [] });

		await expect(service.getSetByNumber('75192-1')).rejects.toThrow(BricksetApiError);
		// Only one call - no retry
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	it('should throw BricksetApiError with 404 when set not found', async () => {
		mockSuccessResponse({ matches: 0, sets: [] });

		await expect(service.getSetByNumber('99999')).rejects.toThrow(BricksetApiError);

		try {
			await service.getSetByNumber('99999');
		} catch (e: any) {
			expect(e.statusCode).toBe(404);
			expect(e.apiStatus).toBe('not_found');
			expect(e.message).toContain('99999');
		}
	});

	it('should return exact match when multiple results found', async () => {
		const exactSet = makeSetResponse({ number: '75192-1', name: 'Millennium Falcon' });
		const variantSet = makeSetResponse({ setID: 99999, number: '75192-2', name: 'Millennium Falcon (Variant)' });
		mockSuccessResponse({ matches: 2, sets: [variantSet, exactSet] });

		const result = await service.getSetByNumber('75192-1');

		expect(result.number).toBe('75192-1');
		expect(result.name).toBe('Millennium Falcon');
	});

	it('should return first result when no exact match among multiple results', async () => {
		const set1 = makeSetResponse({ number: '75192-3', name: 'Variant 3' });
		const set2 = makeSetResponse({ setID: 99999, number: '75192-4', name: 'Variant 4' });
		mockSuccessResponse({ matches: 2, sets: [set1, set2] });

		const result = await service.getSetByNumber('75192');

		expect(result.number).toBe('75192-3');
	});

	it('should trim whitespace from set number', async () => {
		const set = makeSetResponse();
		mockSuccessResponse({ matches: 1, sets: [set] });

		await service.getSetByNumber('  75192-1  ');

		const params = getLastCallParams();
		expect(params.setNumber).toBe('75192-1');
	});
});

describe('BricksetApiService - getAdditionalImages()', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should return array of additional images on success', async () => {
		const images = [
			{ thumbnailURL: 'https://example.com/thumb1.jpg', imageURL: 'https://example.com/img1.jpg' },
			{ thumbnailURL: 'https://example.com/thumb2.jpg', imageURL: 'https://example.com/img2.jpg' }
		];
		mockSuccessResponse({ matches: 2, additionalImages: images });

		const result = await service.getAdditionalImages(23351);

		expect(result).toHaveLength(2);
		expect(result[0].imageURL).toBe('https://example.com/img1.jpg');
	});

	it('should return empty array when additionalImages is undefined', async () => {
		mockSuccessResponse({ matches: 0 });

		const result = await service.getAdditionalImages(23351);

		expect(result).toEqual([]);
	});

	it('should return empty array when message includes "No additional images"', async () => {
		mockErrorResponse('No additional images found');

		const result = await service.getAdditionalImages(23351);

		expect(result).toEqual([]);
	});

	it('should return empty array on network error (non-fatal)', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Network error'));

		const result = await service.getAdditionalImages(23351);

		expect(result).toEqual([]);
	});

	it('should throw BricksetApiError on API error (not "No additional images")', async () => {
		mockErrorResponse('Invalid API key');

		await expect(service.getAdditionalImages(23351)).rejects.toThrow(BricksetApiError);
	});

	it('should include setID in URL', async () => {
		mockSuccessResponse({ matches: 0, additionalImages: [] });

		await service.getAdditionalImages(23351);

		const callUrl = mockRequestUrl.mock.calls[0][0] as any;
		expect(callUrl.url).toContain('setID=23351');
	});
});

describe('BricksetApiService - validateUserHash()', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should return true when user hash is valid', async () => {
		mockSuccessResponse();

		const result = await service.validateUserHash();

		expect(result).toBe(true);
	});

	it('should return false when user hash is invalid', async () => {
		mockErrorResponse('Invalid user hash');

		const result = await service.validateUserHash();

		expect(result).toBe(false);
	});

	it('should return false when no userHash is set', async () => {
		const unauthService = new BricksetApiService('test-api-key');

		const result = await unauthService.validateUserHash();

		expect(result).toBe(false);
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it('should return false on network error', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Network error'));

		const result = await service.validateUserHash();

		expect(result).toBe(false);
	});

	it('should include userHash in URL', async () => {
		mockSuccessResponse();

		await service.validateUserHash();

		const callUrl = mockRequestUrl.mock.calls[0][0] as any;
		expect(callUrl.url).toContain('checkUserHash');
		expect(callUrl.url).toContain('userHash=test-user-hash');
	});
});

describe('BricksetApiService - getUserOwnedSets()', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should return GetSetsResponse on success', async () => {
		const sets = [makeSetResponse()];
		mockSuccessResponse({ matches: 1, sets });

		const result = await service.getUserOwnedSets();

		expect(result.status).toBe('success');
		expect(result.sets).toHaveLength(1);
	});

	it('should throw BricksetApiError when not authenticated', async () => {
		const unauthService = new BricksetApiService('test-api-key');

		await expect(unauthService.getUserOwnedSets()).rejects.toThrow(BricksetApiError);
		await expect(unauthService.getUserOwnedSets()).rejects.toThrow('authentication required');
	});

	it('should use correct pagination params', async () => {
		mockSuccessResponse({ matches: 0, sets: [] });

		await service.getUserOwnedSets(3, 50);

		const params = getLastCallParams();
		expect(params.owned).toBe('1');
		expect(params.pageNumber).toBe('3');
		expect(params.pageSize).toBe('50');
	});

	it('should throw BricksetApiError on network error', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Connection refused'));

		await expect(service.getUserOwnedSets()).rejects.toThrow(BricksetApiError);
	});
});

describe('BricksetApiService - getUserWantedSets()', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should return GetSetsResponse on success', async () => {
		const sets = [makeSetResponse()];
		mockSuccessResponse({ matches: 1, sets });

		const result = await service.getUserWantedSets();

		expect(result.status).toBe('success');
		expect(result.sets).toHaveLength(1);
	});

	it('should throw BricksetApiError when not authenticated', async () => {
		const unauthService = new BricksetApiService('test-api-key');

		await expect(unauthService.getUserWantedSets()).rejects.toThrow(BricksetApiError);
	});

	it('should use wanted=1 in params', async () => {
		mockSuccessResponse({ matches: 0, sets: [] });

		await service.getUserWantedSets();

		const params = getLastCallParams();
		expect(params.wanted).toBe('1');
	});
});

describe('BricksetApiService - getUserWantedSets() error paths', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should throw BricksetApiError when API returns error status', async () => {
		mockErrorResponse('Unauthorized');

		await expect(service.getUserWantedSets()).rejects.toThrow(BricksetApiError);
		await expect(service.getUserWantedSets()).rejects.toThrow('Unauthorized');
	});

	it('should throw wrapped BricksetApiError on network error', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Connection refused'));

		await expect(service.getUserWantedSets()).rejects.toThrow(BricksetApiError);
		await expect(service.getUserWantedSets()).rejects.toThrow('Failed to fetch wanted sets: Connection refused');
	});

	it('should re-throw BricksetApiError without double-wrapping', async () => {
		mockRequestUrl.mockResolvedValue({
			status: HTTP_STATUS.UNAUTHORIZED,
			json: { status: 'error', message: 'Invalid hash' }
		} as any);

		const err = await service.getUserWantedSets().catch(e => e);
		expect(err).toBeInstanceOf(BricksetApiError);
		// Should not be double-wrapped
		expect(err.message).not.toContain('Failed to fetch wanted sets: Failed to fetch wanted sets');
	});

	it('should throw when no userHash is set', async () => {
		const unauthService = new BricksetApiService('test-api-key');
		await expect(unauthService.getUserWantedSets()).rejects.toThrow(BricksetApiError);
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});
});



describe('BricksetApiService - fallback error messages (|| branches)', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	// Each row: [test label, method invocation, expected fallback message]
	it.each([
		['login()',               (svc: BricksetApiService) => svc.login('user', 'pass'),           'Login failed'],
		['getUserOwnedSets()',    (svc: BricksetApiService) => svc.getUserOwnedSets(),              'Failed to fetch owned sets'],
		['getUserWantedSets()',   (svc: BricksetApiService) => svc.getUserWantedSets(),             'Failed to fetch wanted sets'],
		['setUserFlags()',        (svc: BricksetApiService) => svc.setUserFlags(1, { own: true }),  'Failed to update collection flags'],
		['getSets()',             (svc: BricksetApiService) => svc.getSets({ setNumber: '75192' }), 'Failed to fetch sets'],
		['getAdditionalImages()', (svc: BricksetApiService) => svc.getAdditionalImages(1),          'Failed to fetch additional images'],
	])('%s uses fallback message when data.message is absent', async (_label, invoke, expected) => {
		mockErrorResponse(); // no message field — exercises the || fallback branch
		const err = await invoke(service).catch((e: unknown) => e) as Error;
		expect(err.message).toBe(expected);
	});

	it('setUserFlags() maps want: false to 0', async () => {
		mockSuccessResponse();

		await service.setUserFlags(1, { want: false });

		const params = getLastCallParams();
		expect(params.want).toBe(0);
	});

	it('setUserFlags() maps want: true to 1', async () => {
		mockSuccessResponse();

		await service.setUserFlags(1, { want: true });

		const params = getLastCallParams();
		expect(params.want).toBe(1);
	});

	it('setUserFlags() passes notes unchanged when shorter than 1000 chars (truncate false branch)', async () => {
		mockSuccessResponse();

		const shortNotes = 'Short note';
		await service.setUserFlags(1, { notes: shortNotes });

		// setUserFlags uses URLSearchParams which encodes spaces as '+'; use URLSearchParams to decode
		const callUrl = mockRequestUrl.mock.calls[0][0] as any;
		const qs = callUrl.url.split('?')[1];
		const paramsStr = new URLSearchParams(qs).get('params') ?? '';
		const paramsObj = JSON.parse(paramsStr);
		expect(paramsObj.notes).toBe(shortNotes);
	});

	it('setUserFlags() truncates notes longer than 1000 chars (truncate true branch)', async () => {
		mockSuccessResponse();

		const longNotes = 'x'.repeat(1500);
		await service.setUserFlags(1, { notes: longNotes });

		const callUrl = mockRequestUrl.mock.calls[0][0] as any;
		const qs = callUrl.url.split('?')[1];
		const paramsStr = new URLSearchParams(qs).get('params') ?? '';
		const paramsObj = JSON.parse(paramsStr);
		expect((paramsObj.notes as string).length).toBe(1000);
	});
});

describe('BricksetApiService - getCollection()', () => {
	let service: BricksetApiService;

	beforeEach(() => {
		service = new BricksetApiService('test-api-key', 'test-user-hash');
		vi.clearAllMocks();
	});

	it('should throw BricksetApiError when not authenticated', async () => {
		const unauthService = new BricksetApiService('test-api-key');
		await expect(unauthService.getCollection()).rejects.toThrow(BricksetApiError);
		await expect(unauthService.getCollection()).rejects.toThrow('User authentication required');
	});

	it('should return collection entries on success', async () => {
		const entries = [
			{ setID: 1, owned: true, wanted: false, qtyOwned: 1, qtyWanted: 0 },
			{ setID: 2, owned: false, wanted: true, qtyOwned: 0, qtyWanted: 1 },
		];
		mockRequestUrl.mockResolvedValue({
			status: HTTP_STATUS.OK,
			json: { status: 'success', matches: 2, sets: entries }
		} as any);

		const result = await service.getCollection();

		expect(result).toEqual(entries);
		const callUrl = (mockRequestUrl.mock.calls[0][0] as any).url;
		expect(callUrl).toContain('getCollection');
		expect(callUrl).toContain('userHash=');
	});

	it('should return empty array when sets is null/undefined', async () => {
		mockRequestUrl.mockResolvedValue({
			status: HTTP_STATUS.OK,
			json: { status: 'success', matches: 0 }
		} as any);

		const result = await service.getCollection();
		expect(result).toEqual([]);
	});

	it('should throw BricksetApiError when API returns error status', async () => {
		mockRequestUrl.mockResolvedValue({
			status: HTTP_STATUS.OK,
			json: { status: 'error', message: 'Invalid user hash' }
		} as any);

		await expect(service.getCollection()).rejects.toThrow(BricksetApiError);
		await expect(service.getCollection()).rejects.toThrow('Invalid user hash');
	});

	it('should use default message when API error has no message', async () => {
		mockRequestUrl.mockResolvedValue({
			status: HTTP_STATUS.OK,
			json: { status: 'error' }
		} as any);

		await expect(service.getCollection()).rejects.toThrow('Failed to fetch collection');
	});

	it('should wrap network errors in BricksetApiError', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Network timeout'));

		const err = await service.getCollection().catch(e => e);
		expect(err).toBeInstanceOf(BricksetApiError);
		expect(err.message).toContain('Failed to fetch collection');
		expect(err.message).toContain('Network timeout');
	});

	it('should re-throw BricksetApiError without double-wrapping', async () => {
		mockRequestUrl.mockResolvedValue({
			status: HTTP_STATUS.UNAUTHORIZED,
			json: { status: 'error', message: 'Unauthorized' }
		} as any);

		const err = await service.getCollection().catch(e => e);
		expect(err).toBeInstanceOf(BricksetApiError);
		expect(err.message).not.toContain('Failed to fetch collection: Failed to fetch collection');
	});
});