import { App, normalizePath } from 'obsidian';

/**
 * State cache for tracking previous values
 * Used to detect changes in LEGO set notes for bidirectional sync
 */
export interface CachedState {
	setID: number;
	owned: boolean;
	wanted: boolean;
	qtyOwned?: number;
	userRating?: number;
	lastModified: number;
}

/** Frontmatter for LEGO set notes as returned from Obsidian's metadata cache. */
export type LegoSetFrontmatter = Record<string, unknown>;

/** `persistDebounceMs`: omit for default idle delay (local vault flush); `null` disables debounced writes (tests). */
export type StateCacheOptions = {
	persistDebounceMs?: number | null;
};

const DEFAULT_PERSIST_DEBOUNCE_MS = 10_000;

export class StateCache {
	private cache: Map<string, CachedState> = new Map();
	private readonly cacheFile: string;
	private isDirty = false;
	private persistDebounceTimer: number | null = null;
	private readonly persistDebounceMs: number | null;

	constructor(
		private readonly app: App,
		pluginDir: string,
		options?: StateCacheOptions,
	) {
		this.cacheFile = normalizePath(`${pluginDir}/state-cache.json`);
		const raw = options?.persistDebounceMs;
		this.persistDebounceMs = raw === undefined ? DEFAULT_PERSIST_DEBOUNCE_MS : raw;
	}

	private cancelDebouncedPersist(): void {
		if (this.persistDebounceTimer !== null) {
			window.clearTimeout(this.persistDebounceTimer);
			this.persistDebounceTimer = null;
		}
	}

	/** Writes dirty cache to the vault after idle (local disk only; no network). */
	private scheduleDebouncedPersist(): void {
		if (this.persistDebounceMs === null) {
			return;
		}
		this.cancelDebouncedPersist();
		this.persistDebounceTimer = window.setTimeout(() => {
			this.persistDebounceTimer = null;
			void this.save();
		}, this.persistDebounceMs);
	}

	/**
	 * Load cache from disk
	 */
	async load(): Promise<void> {
		this.cancelDebouncedPersist();
		try {
			const file = this.app.vault.getFileByPath(this.cacheFile);
			if (!file) {
				this.cache = new Map();
				return;
			}

			const data = await this.app.vault.read(file);
			const parsed = JSON.parse(data) as unknown;
			if (parsed && typeof parsed === 'object') {
				const entries = Object.entries(parsed as Record<string, CachedState>);
				this.cache = new Map(entries);
			} else {
				this.cache = new Map();
			}
			this.isDirty = false;
		} catch (error) {
			console.error('Failed to load state cache:', error);
			this.cache = new Map();
		}
	}

	/**
	 * Save cache to disk
	 */
	async save(): Promise<void> {
		this.cancelDebouncedPersist();

		if (!this.isDirty) {
			return; // No changes to save
		}

		try {
			const data = Object.fromEntries(this.cache);
			const json = JSON.stringify(data, null, 2);
			const file = this.app.vault.getFileByPath(this.cacheFile);
			if (file) {
				await this.app.vault.process(file, () => json);
			} else {
				await this.app.vault.create(this.cacheFile, json);
			}
			this.isDirty = false;
		} catch (error) {
			console.error('Failed to save state cache:', error);
		}
	}

	/**
	 * Get cached state for a file
	 */
	get(filePath: string): CachedState | undefined {
		return this.cache.get(filePath);
	}

	/**
	 * Set cached state for a file
	 */
	set(filePath: string, state: CachedState): void {
		this.cache.set(filePath, state);
		this.isDirty = true;
		this.scheduleDebouncedPersist();
	}

	/**
	 * Delete cached state for a file
	 */
	delete(filePath: string): void {
		if (this.cache.delete(filePath)) {
			this.isDirty = true;
			this.scheduleDebouncedPersist();
		}
	}

	/**
	 * Check if cache has state for a file
	 */
	has(filePath: string): boolean {
		return this.cache.has(filePath);
	}

	/**
	 * Clear all cached states
	 */
	clear(): void {
		this.cache.clear();
		this.isDirty = true;
		this.scheduleDebouncedPersist();
	}

	/**
	 * Get number of cached states
	 */
	size(): number {
		return this.cache.size;
	}

	/**
	 * Update state from frontmatter
	 */
	updateFromFrontmatter(filePath: string, frontmatter: LegoSetFrontmatter): void {
		const setID = frontmatter['setID'];
		if (typeof setID !== 'number' || !Number.isFinite(setID)) {
			return;
		}

		const qtyOwned = frontmatter['qtyOwned'];
		const userRating = frontmatter['userRating'];

		const state: CachedState = {
			setID,
			owned: Boolean(frontmatter['owned']),
			wanted: Boolean(frontmatter['wanted']),
			qtyOwned: typeof qtyOwned === 'number' ? qtyOwned : undefined,
			userRating: typeof userRating === 'number' ? userRating : undefined,
			lastModified: Date.now()
		};

		this.set(filePath, state);
	}
}
