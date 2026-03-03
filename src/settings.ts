import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type { TextComponent } from 'obsidian';
import BricksetPlugin from './main';
import { BricksetApiService, BRICKSET_API_KEY } from './bricksetApi';
import type { SyncBehavior } from './types';

export class BricksetSettingTab extends PluginSettingTab {
	plugin: BricksetPlugin;
	private apiService: BricksetApiService | null = null;

	constructor(app: App, plugin: BricksetPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Return the cached BricksetApiService, creating it if necessary.
	 */
	private getApiService(): BricksetApiService {
		this.apiService ??= new BricksetApiService(BRICKSET_API_KEY, this.plugin.settings.userHash);
		return this.apiService;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl('h2', { text: 'Brickset Plugin Settings' });

		this.renderFolderSection(containerEl);
		this.renderAuthSection(containerEl);
		this.renderCollectionSyncSection(containerEl);
		this.renderBidirectionalSyncSection(containerEl);
	}

	// -------------------------------------------------------------------------
	// Section renderers
	// -------------------------------------------------------------------------

	private renderFolderSection(containerElement: HTMLElement): void {
		this.addTextSetting(
			containerElement,
			'LEGO Sets Folder',
			'Folder where LEGO set notes will be created',
			'LEGO Sets',
			() => this.plugin.settings.legoSetsFolder,
			v => { this.plugin.settings.legoSetsFolder = v || 'LEGO Sets'; }
		);
	}

	private renderAuthSection(containerElement: HTMLElement): void {
		containerElement.createEl('h3', { text: 'User Authentication' });
		containerElement.createEl('p', {
			text: 'Provide your Brickset credentials to access personalized features (collection, wishlist, etc.)',
			cls: 'setting-item-description',
		});

		// Username setting
		this.addTextSetting(
			containerElement,
			'Brickset Username',
			'Your Brickset username (optional)',
			'username',
			() => this.plugin.settings.username,
			v => { this.plugin.settings.username = v; }
		);

		// Password setting — mask input, attach Login button
		this.addTextSetting(
			containerElement,
			'Brickset Password',
			'Your Brickset password (optional)',
			'password',
			() => this.plugin.settings.password,
			v => { this.plugin.settings.password = v; },
			text => { text.inputEl.type = 'password'; }
		).addButton(button => button
			.setButtonText('Login')
			.onClick(() => this.handleLoginClick()));

		// Login status
		if (this.plugin.settings.userHash) {
			containerElement.createDiv({ cls: 'brickset-status-ok' })
				.appendText(`Logged in as ${this.plugin.settings.username}`);
		}
	}

	/**
	 * Validate credentials and log in to Brickset.
	 * Persists the returned userHash on success; shows a Notice on any failure.
	 */
	private async handleLoginClick(): Promise<void> {
		if (!this.plugin.settings.username || !this.plugin.settings.password) {
			new Notice('Please enter both username and password');
			return;
		}
		try {
			const userHash = await this.getApiService().login(
				this.plugin.settings.username,
				this.plugin.settings.password
			);
			this.plugin.settings.userHash = userHash;
			this.apiService = null; // invalidate cache so next call uses new userHash
			await this.plugin.saveSettings();
			new Notice('Successfully logged in!');
		} catch (error) {
			new Notice(`Login failed: ${error.message}`);
		}
	}

	private renderCollectionSyncSection(containerElement: HTMLElement): void {
		containerElement.createEl('h3', { text: 'Collection Sync' });
		containerElement.createEl('p', {
			text: 'Configure how your Brickset collection syncs with Obsidian',
			cls: 'setting-item-description',
		});

		// Proposal 1: single reference to the settings object
		const s = this.plugin.settings;

		// Proposal 3: toggle settings as a const config array — add/remove entries here
		const toggles = [
			{ name: 'Sync owned sets',             desc: 'Include sets you own in your collection',                              key: 'syncOwnedSets'        },
			{ name: 'Sync wanted sets (wishlist)', desc: 'Include sets from your wishlist',                                      key: 'syncWantedSets'       },
			{ name: 'Download images during sync', desc: 'Download and store set images locally. Uses 1 extra API call per set', key: 'downloadImagesOnSync' },
			{ name: 'Create base configuration',   desc: 'Automatically create base folder configuration for database view',     key: 'createBaseOnSync'     },
		] as const;

		for (const { name, desc, key } of toggles) {
			this.addToggleSetting(containerElement, name, desc,
				() => s[key],
				v  => { s[key] = v; }
			);
		}

		// Sync behavior dropdown (unique signature — kept explicit)
		this.addDropdownSetting(
			containerElement,
			'Sync behavior',
			'How to handle existing notes during sync',
			[
				{ value: 'create', label: 'Create new notes only' },
				{ value: 'update', label: 'Update existing notes' },
				{ value: 'skip',   label: 'Skip existing notes'   },
			],
			() => s.syncBehavior,
			v  => { s.syncBehavior = v as SyncBehavior; }
		);

		// Page size (unique signature — kept explicit)
		this.addIntSetting(containerElement, {
			name:        'Sets per page',
			desc:        'Number of sets to fetch per API request (1-500). Higher values reduce API calls during sync.',
			placeholder: '300',
			min:         1,
			max:         500,
			get:         () => s.syncPageSize,
			set:         (n: number) => { s.syncPageSize = n; },
		});

		// Proposal 2: destructure to avoid double property access; TS narrows to number inside the block
		const { lastSyncTimestamp } = s;
		if (lastSyncTimestamp != null) {
			containerElement.createDiv({ cls: 'brickset-hint' })
				.appendText(`Last sync: ${new Date(lastSyncTimestamp).toLocaleString()}`);
		}
	}

	private renderBidirectionalSyncSection(containerElement: HTMLElement): void {
		containerElement.createEl('h3', { text: 'Bidirectional Sync' });
		containerElement.createEl('p', {
			text: 'Automatically sync changes from Obsidian back to Brickset.com',
			cls: 'setting-item-description',
		});

		const s = this.plugin.settings;

		// Enable bidirectional sync — side-effects handled via onEnable/onDisable hooks
		this.addToggleSetting(
			containerElement,
			'Enable bidirectional sync',
			'Automatically sync changes from Obsidian to Brickset.com when you modify owned/wanted flags',
			() => s.enableBidirectionalSync,
			v  => { s.enableBidirectionalSync = v; },
			() => { this.plugin.startSyncBack(); new Notice('Bidirectional sync enabled');  },
			() => { this.plugin.stopSyncBack();  new Notice('Bidirectional sync disabled'); }
		);

		// Sync delay
		this.addIntSetting(containerElement, {
			name:        'Sync delay (ms)',
			desc:        'Milliseconds to wait before syncing changes.',
			placeholder: '2000',
			min:         500,
			max:         10000,
			get:         () => s.syncDebounceMs,
			set:         (n: number) => { s.syncDebounceMs = n; },
		});

		// Show sync notifications
		this.addToggleSetting(
			containerElement,
			'Show sync notifications',
			'Display notifications when changes are synced to Brickset',
			() => s.showSyncNotifications,
			v  => { s.showSyncNotifications = v; }
		);

		this.renderBidirectionalSyncInfo(containerElement);
	}

	/**
	 * Render the "How it works" informational block for bidirectional sync.
	 * Extracted to keep {@link renderBidirectionalSyncSection} focused on
	 * setting registration rather than DOM construction.
	 */
	private renderBidirectionalSyncInfo(containerElement: HTMLElement): void {
		const div = containerElement.createDiv({ cls: 'brickset-hint' });
		div.createEl('strong', { text: 'How it works: ' });
		div.appendText('When you change the ');
		div.createEl('code', { text: 'owned' });
		div.appendText(', ');
		div.createEl('code', { text: 'wanted' });
		div.appendText(', ');
		div.createEl('code', { text: 'qtyOwned' });
		div.appendText(', or ');
		div.createEl('code', { text: 'userRating' });
		div.appendText(
			" properties in a LEGO set note's frontmatter, the plugin will automatically sync those changes to your Brickset.com account after the configured delay."
		);
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	/**
	 * Create a text Setting that reads its initial value from `get`,
	 * writes updates via `set`, and persists settings on every change.
	 * The optional `configure` callback allows callers to customise the
	 * TextComponent after it is built (e.g. set inputEl.type = 'password').
	 * Returns the Setting so callers can chain additional controls (e.g. addButton).
	 */
	private addTextSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		placeholder: string,
		get: () => string,
		set: (v: string) => void,
		configure?: (text: TextComponent) => void
	): Setting {
		return new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				text.setPlaceholder(placeholder)
					.setValue(get())
					.onChange(async (value) => {
						set(value);
						await this.plugin.saveSettings();
					});
				configure?.(text);
			});
	}

	/**
	 * Parse `value` as a base-10 integer, clamp it to [min, max],
	 * call `apply` with the result, then persist settings.
	 * Silently ignore empty / partially-typed input (user may still be typing).
	 * Show a Notice when a non-empty, non-numeric value is submitted so the
	 * user knows the input was rejected.
	 */
	private async saveIntSetting(
		value: string,
		min: number,
		max: number,
		apply: (n: number) => void
	): Promise<void> {
		const raw = Number.parseInt(value, 10);
		if (Number.isNaN(raw)) {
			if (value.trim() !== '') new Notice(`"${value}" is not a valid number`);
			return;
		}
		const clamped = Math.min(Math.max(raw, min), max);
		apply(clamped);
		await this.plugin.saveSettings();
	}

	/**
	 * Create a dropdown Setting that reads its initial value from `get`,
	 * write updates via `set`, and persist settings on every change.
	 * Each entry in `options` maps a stored value to a human-readable label.
	 */
	private addDropdownSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		options: { value: string; label: string }[],
		get: () => string,
		set: (v: string) => void
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addDropdown(dropdown => {
				options.forEach(({ value, label }) => dropdown.addOption(value, label));
				dropdown
					.setValue(get())
					.onChange(async (value) => {
						set(value);
						await this.plugin.saveSettings();
					});
			});
	}

	/**
	 * Options for {@link addIntSetting}.
	 */
	private addIntSetting(
		containerEl: HTMLElement,
		opts: {
			name: string;
			desc: string;
			placeholder: string;
			min: number;
			max: number;
			get: () => number;
			set: (n: number) => void;
		}
	): void {
		const { name, desc, placeholder, min, max, get, set } = opts;
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => text
				.setPlaceholder(placeholder)
				.setValue(get().toString())
				.onChange(value => this.saveIntSetting(value, min, max, set)));
	}

	/**
	 * Create a toggle Setting that reads its initial value from `get`,
	 * writes updates via `set`, and persists settings on every change.
	 * The optional `onEnable` and `onDisable` callbacks are invoked after
	 * settings are saved, allowing callers to trigger side-effects without 
	 * duplicating the save logic inline.
	 */
	private addToggleSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		get: () => boolean,
		set: (v: boolean) => void,
		onEnable?: () => void,
		onDisable?: () => void
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle(toggle => toggle
				.setValue(get())
				.onChange(async (value) => {
					set(value);
					await this.plugin.saveSettings();
					if (value) onEnable?.();
					else        onDisable?.();
				}));
	}

}
