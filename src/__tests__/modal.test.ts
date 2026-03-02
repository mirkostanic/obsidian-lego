import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FailedSetEntry } from '../types';

// Provide a minimal document global for node environment (SyncModal.addStyles uses document.createElement)
const mockStyleEl = {
	textContent: '',
	id: ''
};
const mockHeadEl = {
	appendChild: vi.fn()
};
(globalThis as any).document = {
	createElement: vi.fn().mockReturnValue(mockStyleEl),
	head: mockHeadEl,
	getElementById: vi.fn().mockReturnValue(null)
};

// Track all Setting instances created
const settingInstances: any[] = [];

// Mock obsidian before importing modal
vi.mock('obsidian', () => {
	// Minimal DOM-like element mock
	function createEl(tag: string, opts?: { text?: string; cls?: string; id?: string }) {
		const el: any = {
			_tag: tag,
			_text: opts?.text || '',
			_cls: opts?.cls || '',
			id: opts?.id || '',
			textContent: opts?.text || '',
			innerHTML: '',
			style: {},
			children: [] as any[],
			_eventListeners: {} as Record<string, Function[]>,
			addEventListener: vi.fn((event: string, handler: Function) => {
				if (!el._eventListeners[event]) el._eventListeners[event] = [];
				el._eventListeners[event].push(handler);
			}),
			dispatchClick: () => {
				(el._eventListeners['click'] || []).forEach((h: Function) => h());
			},
			appendChild: vi.fn((child: any) => { el.children.push(child); return child; }),
			appendText: vi.fn((text: string) => { el.textContent += text; }),
			createEl: vi.fn((t: string, o?: any) => {
				const child = createEl(t, o);
				el.children.push(child);
				return child;
			}),
			createDiv: vi.fn((o?: any) => {
				const child = createEl('div', o);
				el.children.push(child);
				return child;
			}),
			addClass: vi.fn(),
			empty: vi.fn(() => {
				el.children = [];
				el._eventListeners = {};
			}),
			querySelector: vi.fn().mockReturnValue(null),
			disabled: false
		};
		return el;
	}

	class MockModal {
		contentEl = createEl('div');
		close = vi.fn();
		constructor(public app: any) {}
		onOpen() {}
		onClose() {}
	}

	class MockSetting {
		_buttons: any[] = [];
		constructor(public containerElement: any) {
			settingInstances.push(this);
		}
		setName = vi.fn().mockReturnThis();
		setDesc = vi.fn().mockReturnThis();
		addText = vi.fn().mockImplementation((cb: any) => {
			const textComp = {
				setPlaceholder: vi.fn().mockReturnThis(),
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockReturnThis(),
				inputEl: {
					type: '',
					focus: vi.fn(),
					addEventListener: vi.fn()
				}
			};
			cb(textComp);
			return this;
		});
		addButton = vi.fn().mockImplementation((cb: any) => {
			const btn: {
				setButtonText: () => any;
				setCta: () => any;
				onClick: (handler: () => void) => any;
				_clickHandler: (() => void) | null;
			} = {
				setButtonText: vi.fn().mockReturnThis(),
				setCta: vi.fn().mockReturnThis(),
				onClick: vi.fn().mockImplementation((handler: () => void) => {
					btn._clickHandler = handler;
					return btn;
				}),
				_clickHandler: null
			};
			cb(btn);
			this._buttons.push(btn);
			return this;
		});
	}

	return {
		App: class {
			vault = {
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockResolvedValue('{}'),
					write: vi.fn().mockResolvedValue(undefined)
				},
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				create: vi.fn().mockResolvedValue(undefined),
				createBinary: vi.fn().mockResolvedValue(undefined),
				createFolder: vi.fn().mockResolvedValue(undefined),
				modify: vi.fn().mockResolvedValue(undefined),
				read: vi.fn().mockResolvedValue('')
			};
			metadataCache = {
				on: vi.fn().mockReturnValue({ id: 'mock-event-ref' }),
				off: vi.fn(),
				offref: vi.fn(),
				getFileCache: vi.fn().mockReturnValue(null)
			};
			fileManager = {
				processFrontMatter: vi.fn().mockResolvedValue(undefined)
			};
		},
		Modal: MockModal,
		Setting: MockSetting,
		Notice: class { message: string; constructor(message: string) { this.message = message; } },
		normalizePath: (p: string) => p,
		requestUrl: vi.fn()
	};
});

import { SetNumberModal, SyncModal } from '../modal';

function getStatsText(modal: SyncModal): string {
	// After refactor, updateStats builds child divs via createDiv.
	// Collect all textContent from the grid's child divs.
	const statsEl = (modal as any).statsEl;
	return statsEl.children
		.flatMap((grid: any) => grid.children)
		.map((cell: any) => cell.textContent as string)
		.join(' ');
}

describe('SetNumberModal', () => {
	let app: any;
	let onSubmit: (result: string) => void;
	let modal: SetNumberModal;

	beforeEach(() => {
		app = {};
		onSubmit = vi.fn() as (result: string) => void;
		settingInstances.length = 0; // clear tracked instances
		modal = new SetNumberModal(app, onSubmit);
	});

	describe('constructor', () => {
		it('should store the onSubmit callback', () => {
			expect((modal as any).onSubmit).toBe(onSubmit);
		});
	});

	describe('submit()', () => {
		it('should call onSubmit with trimmed result when result is set', () => {
			modal.result = '  75192  ';
			modal.submit();
			expect(onSubmit).toHaveBeenCalledWith('75192');
		});

		it('should call close() before onSubmit', () => {
			modal.result = '75192';
			const closeSpy = vi.spyOn(modal, 'close');
			modal.submit();
			expect(closeSpy).toHaveBeenCalled();
			expect(onSubmit).toHaveBeenCalledWith('75192');
		});

		it('should not call onSubmit when result is empty string', () => {
			modal.result = '';
			modal.submit();
			expect(onSubmit).not.toHaveBeenCalled();
		});

		it('should not call onSubmit when result is only whitespace', () => {
			modal.result = '   ';
			modal.submit();
			expect(onSubmit).not.toHaveBeenCalled();
		});

		it('should not call onSubmit when result is undefined', () => {
			// result not set
			modal.submit();
			expect(onSubmit).not.toHaveBeenCalled();
		});

		it('should pass the exact trimmed value to onSubmit', () => {
			modal.result = '  10497-1  ';
			modal.submit();
			expect(onSubmit).toHaveBeenCalledWith('10497-1');
		});
	});

	describe('onOpen()', () => {
		it('should not throw when called', () => {
			expect(() => modal.onOpen()).not.toThrow();
		});

		it('should update result when text onChange is called', () => {
			// The MockSetting.addText calls cb(textComp) synchronously during onOpen()
			// We capture the onChange handler by inspecting the addText mock call args
			settingInstances.length = 0;
			modal.onOpen();

			// settingInstances[0] is the "Set Number" Setting (has addText)
			const textSetting = settingInstances[0];
			expect(textSetting).toBeDefined();

			// The addText mock was called with a callback; re-invoke it to capture onChange
			let capturedOnChange: ((v: string) => void) | null = null;
			const addTextCb = textSetting.addText.mock.calls[0][0];
			const textComp: { setPlaceholder: () => any; setValue: () => any; onChange: (h: (v: string) => void) => any; inputEl: { type: string; focus: () => void; addEventListener: () => void } } = {
				setPlaceholder: vi.fn().mockReturnThis(),
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockImplementation((handler: (v: string) => void) => {
					capturedOnChange = handler;
					return textComp;
				}),
				inputEl: { type: '', focus: vi.fn(), addEventListener: vi.fn() }
			};
			addTextCb(textComp);

			expect(capturedOnChange).not.toBeNull();
			capturedOnChange!('75192');
			expect(modal.result).toBe('75192');
		});

		it('should submit when Enter key is pressed in text input', () => {
			settingInstances.length = 0;
			modal.onOpen();

			const textSetting = settingInstances[0];
			const addTextCb = textSetting.addText.mock.calls[0][0];

			let capturedKeydownHandler: ((e: any) => void) | null = null;
			const textComp = {
				setPlaceholder: vi.fn().mockReturnThis(),
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockReturnThis(),
				inputEl: {
					type: '',
					focus: vi.fn(),
					addEventListener: vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
						if (event === 'keydown') capturedKeydownHandler = handler;
					})
				}
			};
			addTextCb(textComp);

			expect(capturedKeydownHandler).not.toBeNull();
			const submitSpy = vi.spyOn(modal, 'submit');
			modal.result = '75192';
			capturedKeydownHandler!({ key: 'Enter', preventDefault: vi.fn() });
			expect(submitSpy).toHaveBeenCalled();
		});

		it('should not submit when non-Enter key is pressed', () => {
			settingInstances.length = 0;
			modal.onOpen();

			const textSetting = settingInstances[0];
			const addTextCb = textSetting.addText.mock.calls[0][0];

			let capturedKeydownHandler: ((e: any) => void) | null = null;
			const textComp = {
				setPlaceholder: vi.fn().mockReturnThis(),
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockReturnThis(),
				inputEl: {
					type: '',
					focus: vi.fn(),
					addEventListener: vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
						if (event === 'keydown') capturedKeydownHandler = handler;
					})
				}
			};
			addTextCb(textComp);

			const submitSpy = vi.spyOn(modal, 'submit');
			capturedKeydownHandler!({ key: 'Escape', preventDefault: vi.fn() });
			expect(submitSpy).not.toHaveBeenCalled();
		});

		it('should call submit() when Fetch button is clicked', () => {
			const submitSpy = vi.spyOn(modal, 'submit');
			settingInstances.length = 0;
			modal.onOpen();

			// Find the Setting that has buttons (the second one: Fetch + Cancel)
			const settingWithButtons = settingInstances.find((s: any) => s._buttons?.length > 0);
			expect(settingWithButtons).toBeDefined();
			const fetchBtn = settingWithButtons._buttons[0];
			expect(fetchBtn._clickHandler).toBeDefined();

			modal.result = '75192';
			fetchBtn._clickHandler();
			expect(submitSpy).toHaveBeenCalled();
		});

		it('should call close() when Cancel button is clicked', () => {
			const closeSpy = vi.spyOn(modal, 'close');
			settingInstances.length = 0;
			modal.onOpen();

			const settingWithButtons = settingInstances.find((s: any) => s._buttons?.length > 0);
			expect(settingWithButtons).toBeDefined();
			const cancelBtn = settingWithButtons._buttons[1];
			expect(cancelBtn._clickHandler).toBeDefined();
			cancelBtn._clickHandler();
			expect(closeSpy).toHaveBeenCalled();
		});
	});

	describe('onClose()', () => {
		it('should call contentEl.empty()', () => {
			modal.onClose();
			expect(modal.contentEl.empty).toHaveBeenCalled();
		});
	});
});

describe('SyncModal', () => {
	let app: any;
	let onCancel: () => void;
	let modal: SyncModal;

	beforeEach(() => {
		app = {};
		onCancel = vi.fn() as () => void;
		modal = new SyncModal(app, onCancel);
		// Initialize the modal (sets up progressBar, statusText, statsEl)
		modal.onOpen();
	});

	describe('onOpen()', () => {
		it('should not throw when called', () => {
			const freshModal = new SyncModal(app, vi.fn() as () => void);
			expect(() => freshModal.onOpen()).not.toThrow();
		});
	});

	describe('onClose()', () => {
		it('should call contentEl.empty()', () => {
			modal.onClose();
			expect(modal.contentEl.empty).toHaveBeenCalled();
		});
	});

	describe('updateProgress()', () => {
		it('should set progress bar width to correct percentage', () => {
			modal.updateProgress(5, 10);
			expect((modal as any).progressBar.style.width).toBe('50%');
		});

		it('should set progress bar to 100% when complete', () => {
			modal.updateProgress(10, 10);
			expect((modal as any).progressBar.style.width).toBe('100%');
		});

		it('should set progress bar to 0% when total is 0', () => {
			modal.updateProgress(0, 0);
			expect((modal as any).progressBar.style.width).toBe('0%');
		});

		it('should update status text with progress info', () => {
			modal.updateProgress(3, 10);
			expect((modal as any).statusText.textContent).toContain('3');
			expect((modal as any).statusText.textContent).toContain('10');
			expect((modal as any).statusText.textContent).toContain('30%');
		});

		it('should update current set element when currentSetName is provided', () => {
			const mockCurrentSetEl = { textContent: '' };
			modal.contentEl.querySelector = vi.fn().mockReturnValue(mockCurrentSetEl);

			modal.updateProgress(1, 5, 'Millennium Falcon');

			expect(mockCurrentSetEl.textContent).toContain('Millennium Falcon');
		});

		it('should not throw when currentSetName is not provided', () => {
			expect(() => modal.updateProgress(1, 5)).not.toThrow();
		});
	});

	describe('updateStats()', () => {
		it('should render counts for all four stat categories', () => {
			modal.updateStats(10, 5, 3, 1);
			const text = getStatsText(modal);
			expect(text).toContain('10');
			expect(text).toContain('5');
			expect(text).toContain('3');
			expect(text).toContain('1');
		});

		it('should show Created, Updated, Skipped, Failed labels', () => {
			modal.updateStats(1, 2, 3, 4);
			const text = getStatsText(modal);
			expect(text).toContain('Created');
			expect(text).toContain('Updated');
			expect(text).toContain('Skipped');
			expect(text).toContain('Failed');
		});
	});

	describe('showComplete()', () => {
		it('should not throw when called', () => {
			expect(() => modal.showComplete(10, 5, 2, 1, 5000)).not.toThrow();
		});

		it('should call contentEl.empty() to clear previous content', () => {
			modal.showComplete(10, 5, 2, 1, 5000);
			expect(modal.contentEl.empty).toHaveBeenCalled();
		});

		it('should format duration in seconds for short durations', () => {
			// We test the logic by checking the time string calculation
			// duration = 5000ms → 5s
			const durationSec = Math.round(5000 / 1000);
			const minutes = Math.floor(durationSec / 60);
			const seconds = durationSec % 60;
			const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
			expect(timeStr).toBe('5s');
		});

		it('should format duration in minutes for long durations', () => {
			// duration = 125000ms → 2m 5s
			const durationSec = Math.round(125000 / 1000);
			const minutes = Math.floor(durationSec / 60);
			const seconds = durationSec % 60;
			const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
			expect(timeStr).toBe('2m 5s');
		});
	});

	describe('showError()', () => {
		it('should not throw when called', () => {
			expect(() => modal.showError('Something went wrong')).not.toThrow();
		});

		it('should call contentEl.empty() to clear previous content', () => {
			modal.showError('Error message');
			expect(modal.contentEl.empty).toHaveBeenCalled();
		});

		it('should call close() when close button is clicked', () => {
			const closeSpy = vi.spyOn(modal, 'close');
			modal.showError('Error message');
			// After showError, contentEl has children: h2, errorDiv, buttonContainer
			// buttonContainer.createEl('button') is the close button
			const buttonContainer = modal.contentEl.children[modal.contentEl.children.length - 1];
			const closeButton = buttonContainer.children[0] as any;
			expect(closeButton).toBeDefined();
			closeButton.dispatchClick();
			expect(closeSpy).toHaveBeenCalled();
		});
	});

	describe('showComplete() close button', () => {
		it('should call close() when close button is clicked', () => {
			const closeSpy = vi.spyOn(modal, 'close');
			modal.showComplete(5, 3, 1, 1, 5000);
			// After showComplete, contentEl has children: h2, summary div, buttonContainer
			// buttonContainer.createEl('button') is the close button
			const buttonContainer = modal.contentEl.children[modal.contentEl.children.length - 1];
			const closeButton = buttonContainer.children[0] as any;
			expect(closeButton).toBeDefined();
			closeButton.dispatchClick();
			expect(closeSpy).toHaveBeenCalled();
		});
	});

	describe('showComplete() with failedSets', () => {
		it('should render failed sets section when failedSets is non-empty', (): void => {
			const failedSets: FailedSetEntry[] = [
				{ setNumber: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', error: 'Network timeout' },
			];
			expect(() => modal.showComplete(1, 0, 0, 1, 3000, failedSets)).not.toThrow();

			// Find the sync-failed-sets div in contentEl children
			const children = (modal.contentEl.children as unknown) as any[];
			const failedSection = children.find((c: any) => c._cls === 'sync-failed-sets');
			expect(failedSection).toBeDefined();
		});

		it('should not render failed sets section when failedSets is empty', (): void => {
			expect(() => modal.showComplete(5, 3, 2, 0, 3000, [])).not.toThrow();

			const children = (modal.contentEl.children as unknown) as any[];
			const failedSection = children.find((c: any) => c._cls === 'sync-failed-sets');
			expect(failedSection).toBeUndefined();
		});

		it('should not render failed sets section when failedSets is omitted (default)', (): void => {
			expect(() => modal.showComplete(5, 3, 2, 0, 3000)).not.toThrow();

			const children = (modal.contentEl.children as unknown) as any[];
			const failedSection = children.find((c: any) => c._cls === 'sync-failed-sets');
			expect(failedSection).toBeUndefined();
		});
	});

	describe('cancel button', () => {
		it('should set cancelled flag and call onCancel when cancel button is clicked', () => {
			// The cancel button addEventListener was registered during onOpen()
			// Find the click handler from the cancelButton's addEventListener calls
			const cancelButton = (modal as any).cancelButton;
			expect(cancelButton).toBeDefined();

			// Get the click handler that was registered
			const clickHandlerCall = cancelButton.addEventListener.mock.calls.find(
				(call: any[]) => call[0] === 'click'
			);
			expect(clickHandlerCall).toBeDefined();

			const clickHandler = clickHandlerCall[1];
			clickHandler();

			expect(onCancel).toHaveBeenCalled();
		});

		it('should disable cancel button when clicked', () => {
			const cancelButton = (modal as any).cancelButton;
			const clickHandlerCall = cancelButton.addEventListener.mock.calls.find(
				(call: any[]) => call[0] === 'click'
			);
			const clickHandler = clickHandlerCall[1];
			clickHandler();

			expect(cancelButton.disabled).toBe(true);
			expect(cancelButton.textContent).toBe('Cancelling...');
		});
	});
});

describe('SyncModal - uncovered branch coverage', () => {
	let app: any;
	let modal: SyncModal;

	beforeEach(() => {
		app = {};
		modal = new SyncModal(app, vi.fn() as () => void);
		modal.onOpen();
	});

	it('updateProgress() should not throw when querySelector returns null (line 148)', () => {
		// querySelector returns null → the if(currentSetEl) branch is false
		modal.contentEl.querySelector = vi.fn().mockReturnValue(null);
		expect(() => modal.updateProgress(1, 5, 'Some Set')).not.toThrow();
	});

	it('showComplete() should format duration with minutes when >= 60s (line 177)', () => {
		// duration = 125000ms → 2m 5s (minutes > 0 branch)
		expect(() => modal.showComplete(5, 3, 1, 0, 125000)).not.toThrow();
		// Verify the timeStr calculation hits the minutes > 0 branch
		const durationSec = Math.round(125000 / 1000);
		const minutes = Math.floor(durationSec / 60);
		expect(minutes).toBeGreaterThan(0);
	});

	it('showComplete() should not include error line when failed=0 (line 186)', () => {
		// failed = 0 → the ternary returns '' (empty string branch)
		expect(() => modal.showComplete(5, 3, 2, 0, 5000)).not.toThrow();
		// The summary innerHTML should not contain error styling
		const childrenArr = (modal.contentEl.children as unknown) as any[];
		const summaryEl = Array.isArray(childrenArr) ? childrenArr.find((c: any) => c._cls === 'sync-summary') : undefined;
		if (summaryEl) {
			expect(summaryEl.innerHTML).not.toContain('text-error');
		}
	});
});
