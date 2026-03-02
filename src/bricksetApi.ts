import { requestUrl } from 'obsidian';
import {
	CheckKeyResponse,
	LoginResponse,
	GetSetsResponse,
	GetAdditionalImagesResponse,
	GetCollectionResponse,
	GetSetsParams,
	LegoSet,
	AdditionalImage,
	CollectionEntry
} from './types';

interface SetCollectionParams {
	own?: 0 | 1;
	want?: 0 | 1;
	qtyOwned?: number;
	rating?: number;
	notes?: string;
}

export class BricksetApiError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public apiStatus?: string
	) {
		super(message);
		this.name = 'BricksetApiError';
	}
}

export class BricksetApiService {
	private readonly baseUrl = 'https://brickset.com/api/v3.asmx';
	private readonly apiKey: string;
	private userHash?: string;

	constructor(apiKey: string, userHash?: string) {
		this.apiKey = apiKey;
		this.userHash = userHash;
	}

	setUserHash(userHash: string) {
		this.userHash = userHash;
	}

	getUserHash(): string | undefined {
		return this.userHash;
	}

	isAuthenticated(): boolean {
		return !!this.userHash;
	}

	/**
	 * Validate the user hash
	 */
	async validateUserHash(): Promise<boolean> {
		if (!this.userHash) {
			return false;
		}

		try {
			const url = `${this.baseUrl}/checkUserHash?apiKey=${encodeURIComponent(this.apiKey)}&userHash=${encodeURIComponent(this.userHash)}`;
			const response = await requestUrl({ url });
			const data: CheckKeyResponse = response.json;
			return data.status === 'success';
		} catch (error) {
			console.error('User hash validation failed:', error);
			return false;
		}
	}

	/**
	 * Validate the API key
	 */
	async validateKey(): Promise<boolean> {
		try {
			const url = `${this.baseUrl}/checkKey?apiKey=${encodeURIComponent(this.apiKey)}`;
			const response = await requestUrl({ url });
			const data: CheckKeyResponse = response.json;
			return data.status === 'success';
		} catch (error) {
			console.error('API key validation failed:', error);
			return false;
		}
	}

	/**
	 * Login to get user hash for authenticated requests
	 */
	async login(username: string, password: string): Promise<string> {
		try {
			const url = `${this.baseUrl}/login?apiKey=${encodeURIComponent(this.apiKey)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
			const response = await requestUrl({ url });
			const data: LoginResponse = response.json;

			if (data.status === 'success' && data.hash) {
				this.userHash = data.hash;
				return data.hash;
			}

			throw new BricksetApiError(
				data.message || 'Login failed',
				response.status,
				data.status
			);
		} catch (error) {
			if (error instanceof BricksetApiError) {
				throw error;
			}
			throw new BricksetApiError(
				`Login failed: ${error.message}`,
				undefined,
				'error'
			);
		}
	}

	/**
	 * Get LEGO set by set number
	 */
	async getSetByNumber(setNumber: string): Promise<LegoSet> {
		// Clean the set number (remove any spaces or dashes)
		const cleanSetNumber = setNumber.trim().replaceAll(/\s+/g, '');
		
		// Try with the exact number first
		let params: GetSetsParams = {
			setNumber: cleanSetNumber,
			pageSize: '20',
			extendedData: '1',
		};

		let sets = await this.getSets(params);
		
		// If no results and the number doesn't have a variant suffix, try adding -1
		if (sets.length === 0 && !cleanSetNumber.includes('-')) {
			params = {
				setNumber: `${cleanSetNumber}-1`,
				pageSize: '1',
				extendedData: '1',
			};
			sets = await this.getSets(params);
		}
		
		if (sets.length === 0) {
			throw new BricksetApiError(
				`Set ${setNumber} not found. Please verify the set number exists on Brickset.com`,
				404,
				'not_found'
			);
		}

		// If multiple results, prefer exact match or first variant
		if (sets.length > 1) {
			// Try to find exact match
			const exactMatch = sets.find(s =>
				s.number === cleanSetNumber ||
				s.number === `${cleanSetNumber}-1`
			);
			if (exactMatch) {
				return exactMatch;
			}
		}

		return sets[0];
	}

	/**
	 * Get user's owned LEGO sets collection
	 */
	async getUserOwnedSets(pageNumber: number = 1, pageSize: number = 20): Promise<GetSetsResponse> {
		return this.getUserSets('owned', pageNumber, pageSize);
	}

	/**
	 * Get user's wanted LEGO sets (wishlist)
	 */
	async getUserWantedSets(pageNumber: number = 1, pageSize: number = 20): Promise<GetSetsResponse> {
		return this.getUserSets('wanted', pageNumber, pageSize);
	}

	/**
	 * Get the user's entire collection efficiently via the getCollection endpoint.
	 * Returns collection status entries (setID, owned, wanted, qty, rating, notes)
	 * without full set details.
	 */
	async getCollection(): Promise<CollectionEntry[]> {
		if (!this.userHash) {
			throw new BricksetApiError(
				'User authentication required. Please login first.',
				401,
				'unauthorized'
			);
		}

		try {
			const url = `${this.baseUrl}/getCollection?apiKey=${encodeURIComponent(this.apiKey)}&userHash=${encodeURIComponent(this.userHash)}`;
			const response = await requestUrl({ url });
			const data: GetCollectionResponse = response.json;

			if (data.status === 'success') return data.sets || [];

			throw new BricksetApiError(
				data.message || 'Failed to fetch collection',
				response.status,
				data.status
			);
		} catch (error) {
			if (error instanceof BricksetApiError) throw error;
			throw new BricksetApiError(
				`Failed to fetch collection: ${error.message}`,
				undefined,
				'error'
			);
		}
	}

	/**
	 * Shared implementation for getUserOwnedSets / getUserWantedSets
	 */
	private async getUserSets(
		type: 'owned' | 'wanted',
		pageNumber: number,
		pageSize: number
	): Promise<GetSetsResponse> {
		if (!this.userHash) {
			throw new BricksetApiError(
				'User authentication required. Please login first.',
				401,
				'unauthorized'
			);
		}

		const params: GetSetsParams = {
			[type]: '1',
			pageSize: pageSize.toString(),
			pageNumber: pageNumber.toString(),
			orderBy: 'YearDesc',
			extendedData: '1',
		};

		try {
			const url = `${this.baseUrl}/getSets?apiKey=${encodeURIComponent(this.apiKey)}&userHash=${encodeURIComponent(this.userHash)}&params=${encodeURIComponent(JSON.stringify(params))}`;
			const response = await requestUrl({ url });
			const data: GetSetsResponse = response.json;

			if (data.status === 'success') return data;

			throw new BricksetApiError(
				data.message || `Failed to fetch ${type} sets`,
				response.status,
				data.status
			);
		} catch (error) {
			if (error instanceof BricksetApiError) throw error;
			throw new BricksetApiError(
				`Failed to fetch ${type} sets: ${error.message}`,
				undefined,
				'error'
			);
		}
	}

	/**
	 * Set user collection status for a LEGO set
	 * Updates owned, wanted, quantity, rating, and notes
	 */
	async setUserFlags(
		setID: number,
		flags: {
			own?: boolean;
			want?: boolean;
			qtyOwned?: number;
			rating?: number;
			notes?: string;
		}
	): Promise<boolean> {
		if (!this.userHash) {
			throw new BricksetApiError(
				'User authentication required. Please login first.',
				401,
				'unauthorized'
			);
		}

		try {
			// Build params object for collection flags only (NOT including setID)
			const paramsObj: SetCollectionParams = {};

			// Add optional flags using exact parameter names from API docs
			// own: 1 or 0. If 0 then qtyOwned is automatically set to 0
			if (flags.own !== undefined) {
				paramsObj.own = flags.own ? 1 : 0;
			}
			// want: 1 or 0
			if (flags.want !== undefined) {
				paramsObj.want = flags.want ? 1 : 0;
			}
			// qtyOwned: 0-999. If > 0 then own is automatically set to 1
			if (flags.qtyOwned !== undefined) {
				paramsObj.qtyOwned = this.clamp(flags.qtyOwned, 0, 999);
			}
			// rating: User rating 1-5
			if (flags.rating !== undefined) {
				paramsObj.rating = this.clamp(flags.rating, 1, 5);
			}
			// notes: User notes, max 1000 characters
			if (flags.notes !== undefined) {
				paramsObj.notes = this.truncate(flags.notes, 1000);
			}

			const qs = new URLSearchParams({
				apiKey:   this.apiKey,
				userHash: this.userHash,
				SetID:    String(setID),
				params:   JSON.stringify(paramsObj),
			});
			const url = `${this.baseUrl}/setCollection?${qs}`;

			const response = await requestUrl({ url });

			const data = response.json;

			if (data.status === 'success') {
				return true;
			}

			throw new BricksetApiError(
				data.message || 'Failed to update collection flags',
				response.status,
				data.status
			);
		} catch (error) {
			if (error instanceof BricksetApiError) {
				throw error;
			}
			throw new BricksetApiError(
				`Failed to update collection flags: ${error.message}`,
				undefined,
				'error'
			);
		}
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}

	private truncate(value: string, maxLength: number): string {
		return value.slice(0, maxLength);
	}

	/**
	 * Get LEGO sets with search parameters
	 */
	async getSets(params: GetSetsParams): Promise<LegoSet[]> {
		try {
			const paramsJson = JSON.stringify(params);
			let url = `${this.baseUrl}/getSets?apiKey=${encodeURIComponent(this.apiKey)}&params=${encodeURIComponent(paramsJson)}`;
			
			if (this.userHash) {
				url += `&userHash=${encodeURIComponent(this.userHash)}`;
			}

			const response = await requestUrl({ url });
			const data: GetSetsResponse = response.json;

			if (data.status === 'success') {
				return data.sets || [];
			}

			throw new BricksetApiError(
				data.message || 'Failed to fetch sets',
				response.status,
				data.status
			);
		} catch (error) {
			if (error instanceof BricksetApiError) {
				throw error;
			}
			throw new BricksetApiError(
				`Failed to fetch sets: ${error.message}`,
				undefined,
				'error'
			);
		}
	}

	/**
	 * Get additional images for a set
	 */
	async getAdditionalImages(setID: number): Promise<AdditionalImage[]> {
		try {
			const url = `${this.baseUrl}/getAdditionalImages?apiKey=${encodeURIComponent(this.apiKey)}&setID=${setID}`;
			const response = await requestUrl({ url });
			const data: GetAdditionalImagesResponse = response.json;

			if (data.status === 'success') {
				return data.additionalImages || [];
			}

			// If no additional images, return empty array (not an error)
			if (data.message?.includes('No additional images')) {
				return [];
			}

			throw new BricksetApiError(
				data.message || 'Failed to fetch additional images',
				response.status,
				data.status
			);
		} catch (error) {
			if (error instanceof BricksetApiError) {
				throw error;
			}
			// Don't throw error for missing images, just return empty array
			console.warn(`Failed to fetch additional images for set [setID=${setID}]:`, error);
			return [];
		}
	}
}
