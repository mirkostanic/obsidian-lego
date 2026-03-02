import { App, Modal, Setting } from 'obsidian';
import { FailedSetEntry } from './types';

export class SetNumberModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: 'Fetch LEGO Set' });

		new Setting(contentEl)
			.setName('Set Number')
			.setDesc('Enter the LEGO set number (e.g., 75192, 10497, 21348)')
			.addText(text => {
				text.setPlaceholder('75192')
					.onChange(value => {
						this.result = value;
					});
				
				// Focus the input field
				text.inputEl.focus();
				
				// Submit on Enter key
				text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						this.submit();
					}
				});
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Fetch')
				.setCta()
				.onClick(() => {
					this.submit();
				}))
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => {
					this.close();
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	submit() {
		if (this.result?.trim()) {
			this.close();
			this.onSubmit(this.result.trim());
		}
	}
}

export class SyncModal extends Modal {
	private progressBar: HTMLElement;
	private statusText: HTMLElement;
	private statsEl: HTMLElement;
	private cancelButton: HTMLButtonElement;

	constructor(
		app: App,
		private readonly onCancel: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('brickset-sync-modal');

		contentEl.createEl('h2', { text: 'Syncing LEGO Collection' });

		const progressContainer = contentEl.createDiv({ cls: 'sync-progress-container' });
		this.createProgressSection(progressContainer);
		this.createStatsSection(progressContainer);

		const buttonContainer = contentEl.createDiv({ cls: 'sync-button-container' });
		this.createCancelButton(buttonContainer);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	updateProgress(current: number, total: number, currentSetName?: string) {
		const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
		
		// Update progress bar
		this.progressBar.style.width = `${percentage}%`;
		
		// Update status text
		this.statusText.textContent = `Progress: ${current} / ${total} sets (${percentage}%)`;
		
		// Update current set if provided
		if (currentSetName) {
			const currentSetEl = this.contentEl.querySelector('.sync-current-set');
			if (currentSetEl) {
				currentSetEl.textContent = `Current: ${currentSetName}`;
			}
		}
	}

	updateStats(created: number, updated: number, skipped: number, failed: number): void {
		this.statsEl.empty();
		const grid = this.statsEl.createDiv({ cls: 'sync-stats-grid' });
		grid.createDiv({ text: `✓ Created: ${created}` });
		grid.createDiv({ text: `↻ Updated: ${updated}` });
		grid.createDiv({ text: `⊘ Skipped: ${skipped}` });
		grid.createDiv({ text: `✗ Failed: ${failed}` });
	}

	showComplete(
		created: number,
		updated: number,
		skipped: number,
		failed: number,
		duration: number,
		failedSets: FailedSetEntry[] = []
	): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Sync Complete.' });

		const total = created + updated + skipped + failed;
		const durationSec = Math.round(duration / 1000);
		const minutes = Math.floor(durationSec / 60);
		const seconds = durationSec % 60;
		const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

		const summary = contentEl.createDiv({ cls: 'sync-summary' });

		const headerP = summary.createEl('p', { cls: 'sync-summary-header' });
		headerP.createEl('strong', { text: 'Summary:' });

		const ul = summary.createEl('ul', { cls: 'sync-summary-list' });
		ul.createEl('li', { text: `• Total sets processed: ${total}` });
		ul.createEl('li', { text: `• New notes created: ${created}` });
		ul.createEl('li', { text: `• Existing notes updated: ${updated}` });
		ul.createEl('li', { text: `• Sets skipped: ${skipped}` });
		if (failed > 0) {
			ul.createEl('li', { text: `• Failed: ${failed}`, cls: 'sync-summary-errors' });
		}

		const timeP = summary.createEl('p', { cls: 'sync-summary-time' });
		timeP.appendText('Time taken: ');
		timeP.createEl('strong', { text: timeStr });

		if (failedSets.length > 0) {
			const errorsSection = contentEl.createDiv({ cls: 'sync-failed-sets' });
			errorsSection.createEl('h3', { text: `Failed Sets (${failedSets.length})` });
			const errorList = errorsSection.createEl('ul', { cls: 'sync-failed-list' });
			for (const entry of failedSets) {
				const li = errorList.createEl('li', { cls: 'sync-failed-item' });
				li.createEl('strong', { text: `${entry.setNumber} – ${entry.name}` });
				li.appendText(` (${entry.theme}): ${entry.error}`);
			}
			errorsSection.createEl('p', {
				text: 'See LEGO Sets/sync-log.md for the full log.',
				cls: 'sync-log-hint'
			});
		}

		this.appendCloseButton(contentEl);
	}

	showError(message: string): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Sync Failed.' });
		contentEl.createDiv({ cls: 'sync-error' })
			.createEl('p', { text: message, cls: 'sync-error-message' });

		this.appendCloseButton(contentEl);
	}

	private appendCloseButton(contentEl: HTMLElement): void {
		contentEl.createDiv({ cls: 'sync-button-container' })
			.createEl('button', { text: 'Close', cls: 'mod-cta' })
			.addEventListener('click', () => this.close());
	}

	private createProgressSection(container: HTMLElement): void {
		this.statusText = container.createEl('p', {
			text: 'Initializing sync...',
			cls: 'sync-status-text'
		});

		const progressBarContainer = container.createDiv({ cls: 'sync-progress-bar-container' });
		this.progressBar = progressBarContainer.createDiv({ cls: 'sync-progress-bar' });
		this.progressBar.style.width = '0%';

		container.createDiv({ cls: 'sync-current-set' });
	}

	private createStatsSection(container: HTMLElement): void {
		this.statsEl = container.createDiv({ cls: 'sync-stats' });
		this.updateStats(0, 0, 0, 0);
	}

	private createCancelButton(container: HTMLElement): void {
		this.cancelButton = container.createEl('button', {
			text: 'Cancel Sync',
			cls: 'mod-warning'
		});
		this.cancelButton.addEventListener('click', () => {
			this.cancelButton.disabled = true;
			this.cancelButton.textContent = 'Cancelling...';
			this.onCancel();
		});
	}
}
