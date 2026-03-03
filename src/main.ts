import { App, Plugin, PluginManifest, Notice, TFile } from 'obsidian';
import { BricksetPluginSettings, DEFAULT_SETTINGS, SyncProgress, SyncResult } from './types';
import { BricksetSettingTab } from './settings';
import { BricksetApiService, BricksetApiError, BRICKSET_API_KEY } from './bricksetApi';
import { NoteCreator } from './noteCreator';
import { SetNumberModal, SyncModal } from './modal';
import { SyncService } from './syncService';
import { SyncBackService } from './syncBackService';
import { StateCache } from './stateCache';

export default class BricksetPlugin extends Plugin {
	settings: BricksetPluginSettings;
	private apiService: BricksetApiService | null = null;
	private syncBackService: SyncBackService | null = null;
	private stateCache: StateCache | null = null;
	private stateCacheTimer: ReturnType<typeof setInterval> | null = null;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
	}

	async onload() {
		await this.loadSettings();

		this.stateCache = new StateCache(this.app, this.manifest.dir || '');
		await this.stateCache.load();

		this.stateCacheTimer = setInterval(() => {
			this.stateCache?.save().catch(err =>
				console.error('Brickset: periodic state cache save failed', err)
			);
		}, 60_000);

		// Add settings tab
		this.addSettingTab(new BricksetSettingTab(this.app, this));

		// Register command to fetch LEGO set
		this.addCommand({
			id: 'fetch-lego-set',
			name: 'Fetch LEGO Set',
			callback: () => this.showSetNumberModal(),
		});

		// Register command to sync collection
		this.addCommand({
			id: 'sync-collection',
			name: 'Sync LEGO Collection from Brickset',
			callback: () => this.syncCollection(),
		});

		// Register command to manually sync current note
		this.addCommand({
			id: 'sync-current-note',
			name: 'Sync Current Note to Brickset',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					if (!checking) {
						this.syncCurrentNote(file);
					}
					return true;
				}
				return false;
			}
		});

		// Ensure folder and .base file exist once the vault is ready
		this.app.workspace.onLayoutReady(() => {
			this.ensureBaseFile();
		});

		// Start bidirectional sync if enabled
		if (this.settings.enableBidirectionalSync) {
			this.startSyncBack();
		}

		console.log('Brickset plugin loaded');
	}

	onunload() {
		this.stopSyncBack();

		if (this.stateCacheTimer) {
			clearInterval(this.stateCacheTimer);
			this.stateCacheTimer = null;
		}

		if (this.stateCache) {
			this.stateCache.save().catch((err) => {
				console.error('Brickset plugin: failed to save state cache on unload', err);
			});
		}

		console.log('Brickset plugin unloaded');
	}

	async loadSettings() {
		this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Reinitialize API service with new settings
		this.apiService = null;
	}

	/**
	 * Create the LEGO Sets folder and its .base sibling file if they don't exist.
	 */
	private async ensureBaseFile(): Promise<void> {
		try {
			const noteCreator = new NoteCreator(this.app, this.settings.legoSetsFolder);
			await noteCreator.ensureBaseFile();
		} catch (err) {
			console.error('Brickset: failed to ensure .base file', err);
		}
	}

	/**
	 * Get or create API service instance
	 */
	private getApiService(): BricksetApiService {
		this.apiService ??= new BricksetApiService(BRICKSET_API_KEY, this.settings.userHash);
		return this.apiService;
	}

	/**
	 * Show modal to input set number
	 */
	private showSetNumberModal() {
		new SetNumberModal(this.app, (setNumber) => {
			this.fetchAndCreateNote(setNumber);
		}).open();
	}

	/**
	 * Fetch LEGO set data and create note
	 */
	private async fetchAndCreateNote(setNumber: string) {
		const loadingNotice = new Notice(`Fetching LEGO set ${setNumber}...`, 0);

		try {
			await this.ensureBaseFile();

			// Get API service
			const api = this.getApiService();

			// Fetch set data
			const set = await api.getSetByNumber(setNumber);
			
			loadingNotice.setMessage(`Fetching images for ${set.name}...`);

			// Fetch additional images
			const additionalImages = await api.getAdditionalImages(set.setID);

			loadingNotice.hide();
			new Notice(`Creating note for ${set.name}...`);

			// Create note
			const noteCreator = new NoteCreator(this.app, this.settings.legoSetsFolder);
			const file = await noteCreator.createSetNote(set, additionalImages);

			// Open the created note
			await this.openFile(file);

		} catch (error) {
			loadingNotice.hide();

			if (error instanceof BricksetApiError) {
				if (error.apiStatus === 'not_found') {
					new Notice(`Set ${setNumber} not found. Please check the set number and try again.`);
				} else {
					new Notice(`API Error: ${error.message}`);
				}
			} else {
				new Notice(`Error: ${error.message}`);
			}

			console.error('Failed to fetch LEGO set:', error);
		}
	}

	/**
	 * Open a file in the editor
	 */
	private async openFile(file: TFile) {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	/**
	 * Validate that all prerequisites for syncing are met.
	 * Throw a user-facing Error if any check fails.
	 */
	private validateSyncPrerequisites(): void {
		if (!this.settings.userHash) {
			throw new Error('Please login with your Brickset credentials in plugin settings first.');
		}
		if (!this.settings.syncOwnedSets && !this.settings.syncWantedSets) {
			throw new Error('Please enable at least one sync option (owned or wanted sets) in plugin settings.');
		}
	}

	/**
	 * Sync LEGO collection from Brickset
	 */
	private async syncCollection(): Promise<void> {
		try {
			this.validateSyncPrerequisites();
			await this.ensureBaseFile();

			const api         = this.getApiService();
			const noteCreator = new NoteCreator(this.app, this.settings.legoSetsFolder);

			// Declare as let so the SyncModal cancel closure can reference it
			// before the SyncService assignment on the next line completes.
			let syncService: SyncService;
			const syncModal = new SyncModal(this.app, () => syncService.cancel());

			syncService = new SyncService(
				this.app,
				this.settings,
				api,
				noteCreator,
				this.buildProgressHandler(syncModal)
			);

			syncModal.open();

			const result = await syncService.syncCollection();

			// Save updated settings (last sync timestamp)
			await this.saveSettings();

			// Write sync log (always — records successes and failures)
			await noteCreator.writeSyncLog(result.failedSets, Date.now());

			this.handleSyncResult(result, syncModal);

		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			new Notice(msg);
			console.error('Collection sync failed:', error);
		}
	}

	/**
	 * Build a progress-update callback that forwards SyncProgress events to the given modal.
	 */
	private buildProgressHandler(syncModal: SyncModal): (progress: SyncProgress) => void {
		return (progress: SyncProgress) => {
			syncModal.updateProgress(
				progress.current,
				progress.total,
				progress.currentSet
					? `${progress.currentSet.number} - ${progress.currentSet.name}`
					: undefined
			);
			syncModal.updateStats(
				progress.created,
				progress.updated,
				progress.skipped,
				progress.failed
			);
		};
	}

	/**
	 * Handle the final SyncResult: show the appropriate modal state and an optional Notice.
	 */
	private handleSyncResult(result: SyncResult, syncModal: SyncModal): void {
		if (result.success) {
			syncModal.showComplete(
				result.created,
				result.updated,
				result.skipped,
				result.failed,
				result.duration,
				result.failedSets
			);
			if (result.created > 0 || result.updated > 0) {
				new Notice(`Sync complete! ${result.created} created, ${result.updated} updated.`);
			}
		} else {
			const errorMsg = result.errors.length > 0
				? result.errors[0]
				: 'Sync was cancelled or failed.';
			syncModal.showError(errorMsg);
		}
	}

	/**
		* Start bidirectional sync service
		*/
	startSyncBack(): void {
		if (!this.settings.userHash) {
			console.warn('Cannot start bidirectional sync: user hash not configured');
			return;
		}

		if (!this.stateCache) {
			console.error('Cannot start bidirectional sync: State cache not initialized');
			return;
		}

		if (!this.syncBackService) {
			const api = this.getApiService();
			this.syncBackService = new SyncBackService(
				this.app,
				api,
				this.stateCache,
				this.settings
			);
		}

		this.syncBackService.startWatching();
		console.log('Bidirectional sync started');
	}

	/**
		* Stop bidirectional sync service
		*/
	stopSyncBack(): void {
		if (this.syncBackService) {
			this.syncBackService.stopWatching();
			console.log('Bidirectional sync stopped');
		}
	}

	/**
		* Manually sync current note to Brickset
		*/
	private async syncCurrentNote(file: TFile): Promise<void> {
		if (!this.settings.userHash) {
			new Notice('Please login in plugin settings first.');
			return;
		}

		if (!this.syncBackService) {
			new Notice('Bidirectional sync is not initialized.');
			return;
		}

		try {
			const success = await this.syncBackService.syncFile(file);
			if (success) {
				new Notice(`Synced ${file.basename} to Brickset`);
			} else {
				new Notice(`Failed to sync ${file.basename}`);
			}
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			new Notice(`Error syncing note: ${msg}`);
			console.error('Failed to sync note:', error);
		}
	}
}
