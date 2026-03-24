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

export class StateCache {
	private cache: Map<string, CachedState> = new Map();
	private readonly cacheFile: string;
	private isDirty = false;

	constructor(private readonly app: App, pluginDir: string) {
		this.cacheFile = normalizePath(`${pluginDir}/state-cache.json`);
	}

	/**
	 * Load cache from disk
	 */
	async load(): Promise<void> {
		try {
			const file = this.app.vault.getFileByPath(this.cacheFile);
			if (!file) {
				this.cache = new Map();
				return;
			}

			const data = await this.app.vault.read(file);
			const parsed = JSON.parse(data);
			this.cache = new Map(Object.entries(parsed));
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
	}

	/**
	 * Delete cached state for a file
	 */
	delete(filePath: string): void {
		if (this.cache.delete(filePath)) {
			this.isDirty = true;
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
