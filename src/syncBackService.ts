import { App, TFile, Notice } from 'obsidian';
import { BricksetApiService } from './bricksetApi';
import { StateCache, type LegoSetFrontmatter } from './stateCache';
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
	private processingTimer: number | null = null;
	private isProcessing: boolean = false;

	constructor(
		private readonly app: App,
		private readonly apiService: BricksetApiService,
		private readonly stateCache: StateCache,
		private readonly settings: BricksetPluginSettings
	) {}

	/**
	 * No-op placeholder; the metadata listener is registered on the plugin with
	 * registerEvent for automatic cleanup on unload.
	 */
	startWatching(): void {
		// Metadata listener is owned by BricksetPlugin; this hook remains for API symmetry.
	}

	/**
	 * Clear debounce timer (e.g. when bidirectional sync is disabled).
	 */
	stopWatching(): void {
		if (this.processingTimer !== null) {
			window.clearTimeout(this.processingTimer);
			this.processingTimer = null;
		}
	}

	/**
	 * Handle file metadata change (invoked from plugin-registered listener).
	 *
	 * Synchronous: changes are queued and processed later by a debounced timer
	 * (see `scheduleProcessing` → `processQueue`), so this method itself never
	 * awaits any work.
	 */
	onMetadataChanged(file: TFile): void {
		if (!this.isLegoSetNote(file)) return;

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) return;

		const frontmatter = cache.frontmatter as LegoSetFrontmatter;
		const rawSetID: unknown = frontmatter['setID'];
		if (typeof rawSetID !== 'number') return;

		const change = this.detectChanges(file, frontmatter);
		if (!change) {
			this.stateCache.updateFromFrontmatter(file.path, frontmatter);
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
		frontmatter: LegoSetFrontmatter
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

		const currentOwned  = Boolean(frontmatter['owned']);
		const currentWanted = Boolean(frontmatter['wanted']);
		// Use strict typeof checks so a missing key reads as `undefined`,
		// matching how StateCache stores absent values. Coercing missing
		// keys to `0` (via `Number(undefined) || 0`) used to fabricate
		// a phantom qtyOwned change against a cached `undefined`, which
		// then triggered the ownership rule below and silently flipped
		// `owned: true` back to `false` for any note created without a
		// qtyOwned field.
		const qtyRaw    = frontmatter['qtyOwned'];
		const ratingRaw = frontmatter['userRating'];
		const currentQtyOwned = typeof qtyRaw    === 'number' ? qtyRaw    : undefined;
		const currentRating   = typeof ratingRaw === 'number' ? ratingRaw : undefined;

		const changes: FrontmatterChange['changes'] = {};

		if (currentOwned  !== prevOwned)  { changes.owned  = currentOwned;  }
		if (currentWanted !== prevWanted) { changes.wanted = currentWanted; }
		// Only record a numeric change when the user actually has a value
		// in frontmatter; removing the field is treated as "leave alone"
		// rather than as a reset to 0/undefined.
		if (currentQtyOwned !== prevQtyOwned && currentQtyOwned !== undefined) {
			changes.qtyOwned = currentQtyOwned;
		}
		if (currentRating !== prevRating && currentRating !== undefined) {
			changes.userRating = currentRating;
		}

		// Apply API ownership rules after all fields are compared
		this.applyOwnershipRules(changes, currentOwned, currentQtyOwned ?? 0);

		if (Object.keys(changes).length === 0) return null;

		// onMetadataChanged narrows setID to a number before calling detectChanges,
		// so the unknown→number cast here is safe.
		const setID = frontmatter['setID'] as number;
		return {
			file,
			setID,
			changes,
			timestamp: Date.now()
		};
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
		_currentQtyOwned: number,
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
		if (this.processingTimer !== null) {
			window.clearTimeout(this.processingTimer);
		}

		this.processingTimer = window.setTimeout(() => {
			void this.processQueue();
		}, this.settings.syncDebounceMs || 2000);
	}

	/**
	 * Process all queued changes.
	 *
	 * If invoked while a previous flush is still running, the call bails out
	 * — but the in-flight flush re-arms the debounce timer at the end if any
	 * changes have been queued during processing, so nothing is lost. Earlier
	 * versions silently dropped those mid-flight changes until an unrelated
	 * future edit happened to schedule another flush.
	 */
	private async processQueue(): Promise<void> {
		if (this.changeQueue.size === 0 || this.isProcessing) {
			return;
		}

		this.isProcessing = true;

		const changes = Array.from(this.changeQueue.values());
		this.changeQueue.clear();

		try {
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

			// Save updated cache before releasing the lock so a concurrent
			// flush attempt can't observe a half-saved state.
			await this.stateCache.save();
		} finally {
			// Hand off any work that arrived while we were flushing before
			// we release the lock — keeps the rescheduling synchronous and
			// guarantees concurrent processQueue() calls during the awaits
			// above (which all bailed at the `isProcessing` guard) don't
			// get permanently dropped.
			const hasMore = this.changeQueue.size > 0;
			this.isProcessing = false;
			if (hasMore) {
				this.scheduleProcessing();
			}
		}
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
			this.stateCache.updateFromFrontmatter(
				change.file.path,
				cache.frontmatter as LegoSetFrontmatter,
			);
		}

		if (this.settings.showSyncNotifications) {
			new Notice(`Synced ${change.file.basename} to Brickset`);
		}
	}

	/**
	 * Update file frontmatter with the changes (including automatic ones)
	 */
	private async updateFileFrontmatter(file: TFile, changes: FrontmatterChange['changes']): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: LegoSetFrontmatter) => {
			const { owned, wanted, qtyOwned, userRating } = changes;
			if (owned      !== undefined) fm['owned']      = owned;
			if (wanted     !== undefined) fm['wanted']     = wanted;
			if (qtyOwned   !== undefined) fm['qtyOwned']   = qtyOwned;
			if (userRating !== undefined) fm['userRating'] = userRating;
		});
	}

	/**
	 * Check if file is a LEGO set note
	 */
	private isLegoSetNote(file: TFile): boolean {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as
			| LegoSetFrontmatter
			| undefined;
		if (!frontmatter) return false;
		const tags: unknown = frontmatter['tags'];
		return Array.isArray(tags)
			&& tags.includes('lego')
			&& tags.includes('set')
			&& frontmatter['setID'] !== undefined;
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

		const fm = cache.frontmatter as LegoSetFrontmatter;
		const rawSetID: unknown = fm['setID'];
		if (typeof rawSetID !== 'number') {
			throw new Error('No setID in frontmatter');
		}
		const setID = rawSetID;

		const flags: Parameters<BricksetApiService['setUserFlags']>[1] = {
			own: Boolean(fm['owned']),
			want: Boolean(fm['wanted'])
		};

		const qtyOwned = fm['qtyOwned'];
		if (typeof qtyOwned === 'number') {
			flags.qtyOwned = qtyOwned;
		}
		const userRating = fm['userRating'];
		if (typeof userRating === 'number') {
			flags.rating = userRating;
		}

		const success = await this.apiService.setUserFlags(setID, flags);

		if (success) {
			this.stateCache.updateFromFrontmatter(file.path, fm);
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
		return new Promise(resolve => window.setTimeout(resolve, ms));
	}
}
