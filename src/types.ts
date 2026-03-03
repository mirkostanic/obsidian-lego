// Brickset API Response Types

export interface BricksetApiResponse {
	status: string;
	message?: string;
}

export interface CheckKeyResponse extends BricksetApiResponse {
	// status: 'success' or 'error'
}

export interface LoginResponse extends BricksetApiResponse {
	hash?: string;
}

export interface GetSetsResponse extends BricksetApiResponse {
	matches: number;
	sets: LegoSet[];
}

export interface GetAdditionalImagesResponse extends BricksetApiResponse {
	matches: number;
	additionalImages: AdditionalImage[];
}

export interface CollectionStatus {
	owned: boolean;
	wanted: boolean;
	qtyOwned?: number;
	qtyWanted?: number;
	rating?: number;
	notes?: string;
}

export interface CommunityCollections {
	ownedBy?: number;
	wantedBy?: number;
}

export interface CollectionEntry {
	setID: number;
	owned: boolean;
	wanted: boolean;
	qtyOwned: number;
	qtyWanted: number;
	rating?: number;
	notes?: string;
}

export interface GetCollectionResponse extends BricksetApiResponse {
	matches: number;
	sets: CollectionEntry[];
}

export interface LegoSet {
	setID: number;
	number: string;
	numberVariant: number;
	name: string;
	year: number;
	theme: string;
	themeGroup: string;
	subtheme: string;
	category: string;
	released: boolean;
	pieces?: number;
	minifigs?: number;
	image: {
		thumbnailURL: string;
		imageURL: string;
	};
	bricksetURL: string;
	collection?: CollectionStatus;
	collections?: CommunityCollections;
	LEGOCom?: {
		US?: {
			retailPrice?: number;
			dateFirstAvailable?: string;
			dateLastAvailable?: string;
		};
		UK?: {
			retailPrice?: number;
			dateFirstAvailable?: string;
			dateLastAvailable?: string;
		};
		CA?: {
			retailPrice?: number;
			dateFirstAvailable?: string;
			dateLastAvailable?: string;
		};
		DE?: {
			retailPrice?: number;
			dateFirstAvailable?: string;
			dateLastAvailable?: string;
		};
	};
	rating?: number;
	reviewCount?: number;
	packagingType?: string;
	availability?: string;
	ageRange?: {
		min?: number;
		max?: number;
	};
	dimensions?: {
		height?: number;
		width?: number;
		depth?: number;
		weight?: number;
	};
	barcode?: {
		EAN?: string;
		UPC?: string;
	};
	extendedData?: {
		description?: string;
		notes?: string;
		tags?: string[];
	};
	lastUpdated: string;
}

export interface AdditionalImage {
	thumbnailURL: string;
	imageURL: string;
}

export interface GetSetsParams {
	setNumber?: string;
	query?: string;
	setID?: string;
	theme?: string;
	subtheme?: string;
	year?: string;
	tag?: string;
	owned?: string;
	wanted?: string;
	updatedSince?: string;
	orderBy?: string;
	pageSize?: string;
	pageNumber?: string;
	extendedData?: string;
}

// Sync Progress Interface
export interface SyncProgress {
	total: number;
	current: number;
	created: number;
	updated: number;
	skipped: number;
	failed: number;
	currentSet?: LegoSet;
}

// Entry for a set that failed to sync
export interface FailedSetEntry {
	setNumber: string;
	name: string;
	theme: string;
	error: string;
}

// Sync Result Interface
export interface SyncResult {
	success: boolean;
	total: number;
	created: number;
	updated: number;
	skipped: number;
	failed: number;
	errors: string[];
	failedSets: FailedSetEntry[];
	duration: number; // milliseconds
}

// Sync Behavior Type
export type SyncBehavior = 'create' | 'update' | 'skip';

// Plugin Settings Interface
export interface BricksetPluginSettings {
	username: string;
	password: string;
	legoSetsFolder: string;
	userHash?: string;
	
	// Collection sync settings (Brickset → Obsidian)
	syncOwnedSets: boolean;
	syncWantedSets: boolean;
	syncBehavior: SyncBehavior;
	downloadImagesOnSync: boolean;
	createBaseOnSync: boolean;
	lastSyncTimestamp?: number;
	syncPageSize: number;
	
	// Bidirectional sync settings (Obsidian → Brickset)
	enableBidirectionalSync: boolean;
	syncDebounceMs: number;
	showSyncNotifications: boolean;
}

export const DEFAULT_SETTINGS: BricksetPluginSettings = {
	username: '',
	password: '',
	legoSetsFolder: 'LEGO Sets',
	userHash: undefined,
	
	// Collection sync defaults
	syncOwnedSets: true,
	syncWantedSets: false,
	syncBehavior: 'update',
	downloadImagesOnSync: false,
	createBaseOnSync: true,
	lastSyncTimestamp: undefined,
	syncPageSize: 300,
	
	// Bidirectional sync defaults
	enableBidirectionalSync: true,
	syncDebounceMs: 2000,
	showSyncNotifications: true
};
