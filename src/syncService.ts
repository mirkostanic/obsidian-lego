import { App } from 'obsidian';
import { BricksetApiService } from './bricksetApi';
import { NoteCreator, buildSetPaths } from './noteCreator';
import {
	BricksetPluginSettings,
	SyncProgress,
	SyncResult,
	FailedSetEntry,
	LegoSet,
	AdditionalImage
} from './types';

export class SyncService {
	private cancelled = false;
	private readonly progress: SyncProgress = {
		total: 0,
		current: 0,
		created: 0,
		updated: 0,
		skipped: 0,
		failed: 0
	};
	private readonly failedSets: FailedSetEntry[] = [];

	constructor(
		private readonly app: App,
		private readonly settings: BricksetPluginSettings,
		private readonly apiService: BricksetApiService,
		private readonly noteCreator: NoteCreator,
		private readonly onProgress?: (progress: SyncProgress) => void
	) {}

	/**
	 * Cancel the sync operation
	 */
	cancel() {
		this.cancelled = true;
	}

	/**
	 * Sync user's collection from Brickset
	 */
	async syncCollection(): Promise<SyncResult> {
		const startTime = Date.now();
		const errors: string[] = [];
		this.cancelled = false;
		this.failedSets.length = 0;

		try {
			await this.validateSession();

			const rawSets: LegoSet[] = [
				...(this.settings.syncOwnedSets  ? await this.fetchAllSets('owned')  : []),
				...(this.settings.syncWantedSets ? await this.fetchAllSets('wanted') : []),
			];

			const allSets = this.deduplicateBySetID(rawSets);

			if (allSets.length === 0) {
				return this.buildSyncResult(true, [], startTime);
			}

			// Initialize progress
			this.progress.total = allSets.length;
			this.updateProgress();

			// Process each set
			await this.processSets(allSets, errors);

			// Update last sync timestamp
			this.settings.lastSyncTimestamp = Date.now();

			return this.buildSyncResult(!this.cancelled, errors, startTime);

		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
			return this.buildSyncResult(false, errors, startTime);
		}
	}

	/**
	 * Validate that the user is authenticated and the session hash is still valid
	 */
	private async validateSession(): Promise<void> {
		if (!this.apiService.isAuthenticated()) {
			throw new Error('User not authenticated. Please login first.');
		}
		const isValidHash = await this.apiService.validateUserHash();
		if (!isValidHash) {
			throw new Error('User session expired. Please login again in plugin settings.');
		}
	}

	/**
	 * Build a SyncResult from current progress state
	 */
	private buildSyncResult(success: boolean, errors: string[], startTime: number): SyncResult {
		return {
			success,
			total:   this.progress.total,
			created: this.progress.created,
			updated: this.progress.updated,
			skipped: this.progress.skipped,
			failed:  this.progress.failed,
			errors,
			failedSets: [...this.failedSets],
			duration: Date.now() - startTime,
		};
	}

	/**
	 * Fetch all sets of a specific type (owned or wanted) with pagination
	 */
	private async fetchAllSets(type: 'owned' | 'wanted'): Promise<LegoSet[]> {
		const allSets: LegoSet[] = [];
		const fetchPage = type === 'owned'
			? (page: number) => this.apiService.getUserOwnedSets(page, this.settings.syncPageSize)
			: (page: number) => this.apiService.getUserWantedSets(page, this.settings.syncPageSize);

		let pageNumber = 1;
		let hasMorePages = true;

		while (hasMorePages && !this.cancelled) {
			try {
				const response = await fetchPage(pageNumber);

				if (response.sets?.length) {
					allSets.push(...response.sets);
					hasMorePages = pageNumber * this.settings.syncPageSize < response.matches;
					pageNumber++;
				} else {
					hasMorePages = false;
				}
			} catch (error) {
				console.error("Failed to fetch sets page %d: type: %s", pageNumber, type, error);
				throw error;
			}
		}

		return allSets;
	}

	/**
	 * Iterate over all sets and process each one, collecting errors
	 */
	private async processSets(allSets: LegoSet[], errors: string[]): Promise<void> {
		for (const set of allSets) {
			if (this.cancelled) {
				break;
			}

			this.progress.currentSet = set;
			this.progress.current++;
			this.updateProgress();

			try {
				await this.withRetry(() => this.processSet(set));
			} catch (error) {
				this.progress.failed++;
				const wrappedMsg = error instanceof Error ? error.message : String(error);
				// processSet wraps as "Failed to process set: <original>"; strip the prefix
				const prefix = 'Failed to process set: ';
				const originalMsg = wrappedMsg.startsWith(prefix)
					? wrappedMsg.slice(prefix.length)
					: wrappedMsg;
				const errorMsg = `Failed to process set ${set.number}: ${originalMsg}`;
				errors.push(errorMsg);
				this.failedSets.push({
					setNumber: set.number,
					name: set.name,
					theme: set.theme,
					error: originalMsg,
				});
				console.error("Sync error:", errorMsg, error);
			}

		}
	}

	/**
	 * Process a single set (create or update note)
	 */
	private async processSet(set: LegoSet): Promise<void> {
		try {
			const { filePath, imagesFolderPath } = buildSetPaths(this.settings.legoSetsFolder, set);
			const existingFile = this.app.vault.getAbstractFileByPath(filePath);

			if (existingFile) {
				if (this.settings.syncBehavior === 'skip' || this.settings.syncBehavior === 'create') {
					this.progress.skipped++;
					return;
				}
			}

			let additionalImages: AdditionalImage[] = [];
			if (this.settings.downloadImagesOnSync) {
				if (existingFile) {
					additionalImages = this.resolveLocalAdditionalImages(imagesFolderPath, set.image?.imageURL);
				} else {
					try {
						additionalImages = await this.apiService.getAdditionalImages(set.setID);
					} catch (error) {
						console.warn("Failed to fetch additional images for set %s:", set.number, error);
					}
				}
			}

			await this.noteCreator.createSetNote(set, additionalImages);

			if (existingFile) {
				this.progress.updated++;
			} else {
				this.progress.created++;
			}

		} catch (error) {
			throw new Error(`Failed to process set: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Reconstruct AdditionalImage entries from files already stored locally.
	 * NoteCreator saves additional images as `images/additional-1.jpg`,
	 * `images/additional-2.jpg`, … inside the set folder.
	 * Probe the vault for those files and build synthetic AdditionalImage
	 * objects so NoteCreator can include them in the note without an API call.
	 *
	 * @param imagesFolderPath  Vault path to the set's `images/` sub-folder
	 * @param mainImageUrl      The set's primary image URL (used as imageURL for
	 *                          the main image; additional images use a placeholder)
	 */
	private resolveLocalAdditionalImages(
		imagesFolderPath: string,
		mainImageUrl: string | undefined
	): AdditionalImage[] {
		const images: AdditionalImage[] = [];
		for (let i = 1; ; i++) {
			const filePath = `${imagesFolderPath}/additional-${i}.jpg`;
			if (!this.app.vault.getAbstractFileByPath(filePath)) break;
			// The imageURL is only used by downloadImage() which skips download
			// when the file already exists, so the value here is a placeholder.
			images.push({ thumbnailURL: filePath, imageURL: filePath });
		}
		return images;
	}

	/**
	 * Update progress and notify callback
	 */
	private updateProgress() {
		this.onProgress?.({ ...this.progress });
	}

	/**
	 * Remove duplicate sets (by setID) that appear in both owned and wanted lists.
	 */
	private deduplicateBySetID(sets: LegoSet[]): LegoSet[] {
		const seen = new Map<number, LegoSet>();
		for (const set of sets) {
			if (!seen.has(set.setID)) {
				seen.set(set.setID, set);
			}
		}
		return [...seen.values()];
	}

	/**
	 * Retry an async operation with exponential backoff.
	 */
	private async withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
		for (let i = 0; ; i++) {
			try {
				return await fn();
			} catch (error) {
				if (i >= attempts - 1) throw error;
				await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
			}
		}
	}

	/**
	 * Get current progress
	 */
	getProgress(): SyncProgress {
		return { ...this.progress };
	}
}
