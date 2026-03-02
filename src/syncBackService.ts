import { App, TFile, Notice, EventRef } from 'obsidian';
import { BricksetApiService } from './bricksetApi';
import { StateCache } from './stateCache';
import { BricksetPluginSettings } from './types';

/**
 * Represents a detected change in frontmatter
 */
interface FrontmatterChange {
	file: TFile;
	setID: number;
	changes: {
		owned?: boolean;
		wanted?: boolean;
		qtyOwned?: number;
		userRating?: number;
	};
	timestamp: number;
}

/**
 * Service for syncing local changes back to Brickset.com
 * Monitors frontmatter changes and updates the API accordingly
 */
export class SyncBackService {
	private readonly changeQueue: Map<string, FrontmatterChange> = new Map();
	private processingTimer: NodeJS.Timeout | null = null;
	private metadataChangeRef: EventRef | null = null;
	private isProcessing: boolean = false;

	constructor(
		private readonly app: App,
		private readonly apiService: BricksetApiService,
		private readonly stateCache: StateCache,
		private readonly settings: BricksetPluginSettings
	) {}

	/**
	 * Start monitoring for frontmatter changes
	 */
	startWatching(): void {
		if (this.metadataChangeRef) {
			return; // Already watching
		}

		this.metadataChangeRef = this.app.metadataCache.on(
			'changed',
			this.handleFileChange.bind(this)
		);

		console.log('SyncBackService: Started watching for changes');
	}

	/**
	 * Stop monitoring
	 */
	stopWatching(): void {
		if (this.metadataChangeRef) {
			this.app.metadataCache.offref(this.metadataChangeRef);
			this.metadataChangeRef = null;
		}

		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
			this.processingTimer = null;
		}

		console.log('SyncBackService: Stopped watching');
	}

	/**
	 * Handle file metadata change
	 */
	private async handleFileChange(file: TFile): Promise<void> {
		if (!this.isLegoSetNote(file)) return;

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) return;

		const setID = cache.frontmatter.setID;
		if (!setID || typeof setID !== 'number') return;

		const change = this.detectChanges(file, cache.frontmatter);
		if (!change) {
			this.stateCache.updateFromFrontmatter(file.path, cache.frontmatter);
			return;
		}

		// Add to queue (overwrites previous change for same file)
		this.changeQueue.set(file.path, change);
		this.scheduleProcessing();
	}

	/**
	 * Detect what changed in frontmatter
	 */
	private detectChanges(
		file: TFile,
		frontmatter: any
	): FrontmatterChange | null {
		// Get previous state from cache
		const previousState = this.stateCache.get(file.path);

		// If no previous state, this is the first time we're seeing this file.
		// Store current state but don't sync (assume it's already in sync).
		if (!previousState) {
			this.stateCache.updateFromFrontmatter(file.path, frontmatter);
			return null;
		}

		const { owned: prevOwned, wanted: prevWanted, qtyOwned: prevQtyOwned, userRating: prevRating } = previousState;

		const currentOwned    = frontmatter.owned    || false;
		const currentWanted   = frontmatter.wanted   || false;
		const currentQtyOwned = frontmatter.qtyOwned || 0;
		const currentRating   = frontmatter.userRating;

		const changes: FrontmatterChange['changes'] = {};

		if (currentOwned    !== prevOwned)    { changes.owned      = currentOwned; }
		if (currentWanted   !== prevWanted)   { changes.wanted     = currentWanted; }
		if (currentQtyOwned !== prevQtyOwned) { changes.qtyOwned   = currentQtyOwned; }
		if (currentRating   !== prevRating)   { changes.userRating = currentRating; }

		// Apply API ownership rules after all fields are compared
		this.applyOwnershipRules(changes, currentOwned, currentQtyOwned);

		if (Object.keys(changes).length === 0) return null;

		return { file, setID: frontmatter.setID, changes, timestamp: Date.now() };
	}

	/**
	 * Enforce Brickset API ownership consistency rules on a pending changes object.
	 *
	 * Rule 1: If `owned` is being set to false and `qtyOwned` is not already
	 *         part of this change, force `qtyOwned` to 0 (API resets it automatically).
	 * Rule 2: If `qtyOwned` is part of this change, derive `owned` from it:
	 *         qtyOwned > 0 → owned = true; qtyOwned = 0 → owned = false.
	 */
	private applyOwnershipRules(
		changes: FrontmatterChange['changes'],
		_currentOwned: boolean,
		_currentQtyOwned: number
	): void {
		// Rule 1: owned=false automatically resets qtyOwned to 0
		if (changes.owned === false && changes.qtyOwned === undefined) {
			changes.qtyOwned = 0;
		}
		// Rule 2: qtyOwned change drives the owned flag
		if (changes.qtyOwned !== undefined) {
			changes.owned = changes.qtyOwned > 0;
		}
	}

	/**
	 * Schedule queue processing with debounce
	 */
	private scheduleProcessing(): void {
		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
		}

		this.processingTimer = setTimeout(() => {
			this.processQueue();
		}, this.settings.syncDebounceMs || 2000);
	}

	/**
	 * Process all queued changes
	 */
	private async processQueue(): Promise<void> {
		if (this.changeQueue.size === 0 || this.isProcessing) {
			return;
		}

		this.isProcessing = true;

		const changes = Array.from(this.changeQueue.values());
		this.changeQueue.clear();

		for (const change of changes) {
			try {
				await this.syncToApi(change);
			} catch (error) {
					console.error("Failed to sync %s:", change.file.path, error);
					
					if (this.settings.showSyncNotifications) {
						const safeName = change.file.basename.replaceAll(/[\r\n]/g, '_');
						const safeMsg = (error instanceof Error ? error.message : String(error)).replaceAll(/[\r\n]/g, '_');
						new Notice(`Failed to sync ${safeName} to Brickset: ${safeMsg}`);
					}
			}

			// Small delay between API calls to avoid rate limiting
			await this.delay(100);
		}

		this.isProcessing = false;

		// Save updated cache
		await this.stateCache.save();
	}

	/**
	 * Sync a single change to Brickset API
	 */
	private async syncToApi(change: FrontmatterChange): Promise<void> {
		const { owned, wanted, qtyOwned, userRating } = change.changes;
		const flags = {
			...(owned      !== undefined && { own:      owned      }),
			...(wanted     !== undefined && { want:     wanted     }),
			...(qtyOwned   !== undefined && { qtyOwned: qtyOwned   }),
			...(userRating !== undefined && { rating:   userRating }),
		};

		const success = await this.apiService.setUserFlags(change.setID, flags);

		if (!success) throw new Error('API returned error');

		await this.updateFileFrontmatter(change.file, change.changes);

		const cache = this.app.metadataCache.getFileCache(change.file);
		if (cache?.frontmatter) {
			this.stateCache.updateFromFrontmatter(change.file.path, cache.frontmatter);
		}

		if (this.settings.showSyncNotifications) {
			new Notice(`Synced ${change.file.basename} to Brickset`);
		}
	}

	/**
	 * Update file frontmatter with the changes (including automatic ones)
	 */
	private async updateFileFrontmatter(file: TFile, changes: FrontmatterChange['changes']): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const { owned, wanted, qtyOwned, userRating } = changes;
			if (owned      !== undefined) frontmatter.owned      = owned;
			if (wanted     !== undefined) frontmatter.wanted     = wanted;
			if (qtyOwned   !== undefined) frontmatter.qtyOwned   = qtyOwned;
			if (userRating !== undefined) frontmatter.userRating = userRating;
		});
	}

	/**
	 * Check if file is a LEGO set note
	 */
	private isLegoSetNote(file: TFile): boolean {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) return false;
		const tags = frontmatter.tags;
		return Array.isArray(tags)
			&& tags.includes('lego')
			&& tags.includes('set')
			&& frontmatter.setID !== undefined;
	}

	/**
	 * Manually sync a specific file
	 */
	async syncFile(file: TFile): Promise<boolean> {
		if (!this.isLegoSetNote(file)) {
			throw new Error('Not a LEGO set note');
		}

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) {
			throw new Error('No frontmatter found');
		}

		const setID = cache.frontmatter.setID;
		if (!setID) {
			throw new Error('No setID in frontmatter');
		}

		// Build flags from current frontmatter
		const flags: any = {
			own: cache.frontmatter.owned || false,
			want: cache.frontmatter.wanted || false
		};

		if (cache.frontmatter.qtyOwned !== undefined) {
			flags.qtyOwned = cache.frontmatter.qtyOwned;
		}
		if (cache.frontmatter.userRating !== undefined) {
			flags.rating = cache.frontmatter.userRating;
		}

		const success = await this.apiService.setUserFlags(setID, flags);

		if (success) {
			this.stateCache.updateFromFrontmatter(file.path, cache.frontmatter);
			await this.stateCache.save();
		}

		return success;
	}

	/**
	 * Get current queue size
	 */
	getQueueSize(): number {
		return this.changeQueue.size;
	}

	/**
	 * Check if currently processing
	 */
	isCurrentlyProcessing(): boolean {
		return this.isProcessing;
	}

	/**
	 * Utility delay function
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
