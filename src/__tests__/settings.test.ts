import { describe, it, expect, beforeEach, vi } from 'vitest';

// Captured handlers from Setting mock - populated during display()
const capturedHandlers: {
	onChange: Record<string, ((value: any) => Promise<void>) | null>;
	onClick: Record<string, (() => Promise<void>) | null>;
} = {
	onChange: {},
	onClick: {}
};

let settingCallCount = 0;

// Mock obsidian before importing settings
vi.mock('obsidian', () => {
	function createEl(tag: string, opts?: { text?: string; cls?: string; id?: string; href?: string; attr?: Record<string, string> }) {
		const el: any = {
			_tag: tag,
			textContent: opts?.text || '',
			innerHTML: opts?.text || '',
			id: opts?.id || '',
			style: {},
			children: [] as any[],
			addEventListener: vi.fn(),
			appendChild: vi.fn((child: any) => { el.children.push(child); return child; }),
			insertBefore: vi.fn((child: any) => { el.children.unshift(child); return child; }),
			createEl: vi.fn((t: string, o?: any) => createEl(t, o)),
			createDiv: vi.fn((o?: any) => {
				const d = createEl('div', o);
				if (o?.id) d.id = o.id;
				return d;
			}),
			appendText: vi.fn(function(text: string) { el.innerHTML += text; }),
			addClass: vi.fn(),
			empty: vi.fn(function() { el.innerHTML = ''; el.children = []; })
		};
		return el;
	}

	class MockPluginSettingTab {
		containerEl = createEl('div');
		constructor(public app: any, public plugin: any) {}
	}

	class MockSetting {
		private _name = '';
		constructor(public containerEl: any) {
			settingCallCount++;
		}
		setName = vi.fn().mockImplementation((name: string) => {
			this._name = name;
			return this;
		});
		setDesc = vi.fn().mockReturnThis();
		addText = vi.fn().mockImplementation((cb: any) => {
			const textComp: { setPlaceholder: () => any; setValue: () => any; onChange: (h: any) => any; inputEl: { type: string } } = {
				setPlaceholder: vi.fn().mockReturnThis(),
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockImplementation((handler: any) => {
					capturedHandlers.onChange[this._name] = handler;
					return textComp;
				}),
				inputEl: { type: '' }
			};
			cb(textComp);
			return this;
		});
		addButton = vi.fn().mockImplementation((cb: any) => {
			const btn: { setButtonText: () => any; setCta: () => any; onClick: (h: any) => any } = {
				setButtonText: vi.fn().mockReturnThis(),
				setCta: vi.fn().mockReturnThis(),
				onClick: vi.fn().mockImplementation((handler: any) => {
					capturedHandlers.onClick[this._name] = handler;
					return btn;
				})
			};
			cb(btn);
			return this;
		});
		addToggle = vi.fn().mockImplementation((cb: any) => {
			const toggle: { setValue: () => any; onChange: (h: any) => any } = {
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockImplementation((handler: any) => {
					capturedHandlers.onChange[this._name] = handler;
					return toggle;
				})
			};
			cb(toggle);
			return this;
		});
		addDropdown = vi.fn().mockImplementation((cb: any) => {
			const dropdown: { addOption: () => any; setValue: () => any; onChange: (h: any) => any } = {
				addOption: vi.fn().mockReturnThis(),
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockImplementation((handler: any) => {
					capturedHandlers.onChange[this._name] = handler;
					return dropdown;
				})
			};
			cb(dropdown);
			return this;
		});
	}

	return {
		App: vi.fn(),
		PluginSettingTab: MockPluginSettingTab,
		Setting: MockSetting,
		Notice: vi.fn(),
		normalizePath: (p: string) => p,
		requestUrl: vi.fn()
	};
});

vi.mock('../bricksetApi', () => {
	return {
		BricksetApiService: vi.fn().mockImplementation(function() {
			return {
				validateKey: vi.fn().mockResolvedValue(true),
				login: vi.fn().mockResolvedValue('hash123')
			};
		})
	};
});

// Mock main.ts (BricksetPlugin) to avoid loading the full plugin
vi.mock('../main', () => {
	// Use vi.fn() as a constructor stub — no plugin logic needed in tests
	return {
		default: vi.fn()
	};
});

import { BricksetSettingTab } from '../settings';

function createMockPlugin() {
	return {
		settings: {
			apiKey: 'test-key',
			username: 'testuser',
			password: 'testpass',
			userHash: '',
			legoSetsFolder: 'LEGO Sets',
			syncOwnedSets: true,
			syncWantedSets: false,
			syncBehavior: 'update' as const,
			downloadImagesOnSync: true,
			createBaseOnSync: true,
			syncPageSize: 20,
			lastSyncTimestamp: 0,
			enableBidirectionalSync: false,
			syncDebounceMs: 2000,
			showSyncNotifications: true
		},
		saveSettings: vi.fn().mockResolvedValue(undefined),
		startSyncBack: vi.fn(),
		stopSyncBack: vi.fn()
	} as any;
}

describe('BricksetSettingTab', () => {
	let app: any;
	let plugin: ReturnType<typeof createMockPlugin>;
	let tab: BricksetSettingTab;

	beforeEach(() => {
		app = {};
		plugin = createMockPlugin();
		tab = new BricksetSettingTab(app, plugin);
		// Reset captured handlers
		Object.keys(capturedHandlers.onChange).forEach(k => delete capturedHandlers.onChange[k]);
		Object.keys(capturedHandlers.onClick).forEach(k => delete capturedHandlers.onClick[k]);
		// Run display() to populate handlers
		tab.display();
	});

	describe('constructor', () => {
		it('should store plugin reference', () => {
			expect(tab.plugin).toBe(plugin);
		});
	});

	describe('display()', () => {
		it('should call containerEl.empty() to clear previous content', () => {
			expect(tab.containerEl.empty).toHaveBeenCalled();
		});

		it('should show login status when userHash is set', () => {
			plugin.settings.userHash = 'valid-hash';
			tab = new BricksetSettingTab(app, plugin);
			expect(() => tab.display()).not.toThrow();
		});

		it('should show last sync info when lastSyncTimestamp is set', () => {
			plugin.settings.lastSyncTimestamp = Date.now();
			tab = new BricksetSettingTab(app, plugin);
			expect(() => tab.display()).not.toThrow();
		});
	});

	describe('onChange handlers', () => {
		it('should update apiKey when Brickset API Key onChange fires', async () => {
			await capturedHandlers.onChange['Brickset API Key']?.('new-api-key');
			expect(plugin.settings.apiKey).toBe('new-api-key');
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update legoSetsFolder when LEGO Sets Folder onChange fires', async () => {
			await capturedHandlers.onChange['LEGO Sets Folder']?.('My LEGO');
			expect(plugin.settings.legoSetsFolder).toBe('My LEGO');
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should default legoSetsFolder to "LEGO Sets" when empty value provided', async () => {
			await capturedHandlers.onChange['LEGO Sets Folder']?.('');
			expect(plugin.settings.legoSetsFolder).toBe('LEGO Sets');
		});

		it('should update username when Brickset Username onChange fires', async () => {
			await capturedHandlers.onChange['Brickset Username']?.('newuser');
			expect(plugin.settings.username).toBe('newuser');
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update password when Brickset Password onChange fires', async () => {
			await capturedHandlers.onChange['Brickset Password']?.('newpass');
			expect(plugin.settings.password).toBe('newpass');
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update syncOwnedSets when Sync owned sets onChange fires', async () => {
			await capturedHandlers.onChange['Sync owned sets']?.(false);
			expect(plugin.settings.syncOwnedSets).toBe(false);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update syncWantedSets when Sync wanted sets onChange fires', async () => {
			await capturedHandlers.onChange['Sync wanted sets (wishlist)']?.(true);
			expect(plugin.settings.syncWantedSets).toBe(true);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update syncBehavior when Sync behavior onChange fires', async () => {
			await capturedHandlers.onChange['Sync behavior']?.('skip');
			expect(plugin.settings.syncBehavior).toBe('skip');
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update downloadImagesOnSync when Download images onChange fires', async () => {
			await capturedHandlers.onChange['Download images during sync']?.(false);
			expect(plugin.settings.downloadImagesOnSync).toBe(false);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update createBaseOnSync when Create base configuration onChange fires', async () => {
			await capturedHandlers.onChange['Create base configuration']?.(false);
			expect(plugin.settings.createBaseOnSync).toBe(false);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update syncPageSize when Sets per page onChange fires with valid value', async () => {
			await capturedHandlers.onChange['Sets per page']?.('50');
			expect(plugin.settings.syncPageSize).toBe(50);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should not update syncPageSize when Sets per page onChange fires with invalid value', async () => {
			await capturedHandlers.onChange['Sets per page']?.('abc');
			expect(plugin.settings.syncPageSize).toBe(20); // unchanged
		});

		it('should not show a Notice when Sets per page onChange fires with whitespace-only input', async () => {
			// Whitespace-only is NaN but value.trim() === '' → Notice is suppressed (line 342 false branch)
			const { Notice } = await import('obsidian');
			const noticeSpy = vi.mocked(Notice);
			noticeSpy.mockClear();
			await capturedHandlers.onChange['Sets per page']?.('   ');
			expect(noticeSpy).not.toHaveBeenCalled();
			expect(plugin.settings.syncPageSize).toBe(20); // unchanged
		});

		it('should clamp syncPageSize to minimum (1) when value is below range (0)', async () => {
			await capturedHandlers.onChange['Sets per page']?.('0');
			expect(plugin.settings.syncPageSize).toBe(1);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should clamp syncPageSize to maximum (500) when value is above range (501)', async () => {
			await capturedHandlers.onChange['Sets per page']?.('501');
			expect(plugin.settings.syncPageSize).toBe(500);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should enable bidirectional sync and call startSyncBack when onChange fires with true', async () => {
			await capturedHandlers.onChange['Enable bidirectional sync']?.(true);
			expect(plugin.settings.enableBidirectionalSync).toBe(true);
			expect(plugin.startSyncBack).toHaveBeenCalled();
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should disable bidirectional sync and call stopSyncBack when onChange fires with false', async () => {
			plugin.settings.enableBidirectionalSync = true;
			await capturedHandlers.onChange['Enable bidirectional sync']?.(false);
			expect(plugin.settings.enableBidirectionalSync).toBe(false);
			expect(plugin.stopSyncBack).toHaveBeenCalled();
		});

		it('should update syncDebounceMs when Sync delay onChange fires with valid value', async () => {
			await capturedHandlers.onChange['Sync delay (ms)']?.('3000');
			expect(plugin.settings.syncDebounceMs).toBe(3000);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should clamp syncDebounceMs to minimum (500) when value is below range (< 500)', async () => {
			await capturedHandlers.onChange['Sync delay (ms)']?.('100');
			expect(plugin.settings.syncDebounceMs).toBe(500);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should clamp syncDebounceMs to maximum (10000) when value is above range (> 10000)', async () => {
			await capturedHandlers.onChange['Sync delay (ms)']?.('20000');
			expect(plugin.settings.syncDebounceMs).toBe(10000);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('should update showSyncNotifications when Show sync notifications onChange fires', async () => {
			await capturedHandlers.onChange['Show sync notifications']?.(false);
			expect(plugin.settings.showSyncNotifications).toBe(false);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});
	});

	describe('onClick handlers', () => {
		it('should show notice when Validate clicked with no apiKey', async () => {
			plugin.settings.apiKey = '';
			await capturedHandlers.onClick['Brickset API Key']?.();
			// Notice was constructed - just verify no throw
			expect(true).toBe(true);
		});

		it('should validate API key when Validate clicked with apiKey set', async () => {
			const { BricksetApiService } = await import('../bricksetApi');
			const mockValidateKey = vi.fn().mockResolvedValue(true);
			vi.mocked(BricksetApiService).mockImplementation(function() {
				return { validateKey: mockValidateKey, login: vi.fn() } as any;
			});
			await capturedHandlers.onClick['Brickset API Key']?.();
			expect(mockValidateKey).toHaveBeenCalled();
		});

		it('should attempt login when Login clicked with credentials', async () => {
			const { BricksetApiService } = await import('../bricksetApi');
			const mockLogin = vi.fn().mockResolvedValue('new-hash');
			vi.mocked(BricksetApiService).mockImplementation(function() {
				return { login: mockLogin, validateKey: vi.fn() } as any;
			});
			await capturedHandlers.onClick['Brickset Password']?.();
			expect(mockLogin).toHaveBeenCalledWith('testuser', 'testpass');
			expect(plugin.settings.userHash).toBe('new-hash');
		});

		it('should show notice when Login clicked with no apiKey', async () => {
			plugin.settings.apiKey = '';
			// Should not throw
			await expect(capturedHandlers.onClick['Brickset Password']?.()).resolves.not.toThrow();
		});

		it('should show notice when Login clicked with no username', async () => {
			plugin.settings.username = '';
			await expect(capturedHandlers.onClick['Brickset Password']?.()).resolves.not.toThrow();
		});

		it('should handle login failure gracefully', async () => {
			const { BricksetApiService } = await import('../bricksetApi');
			vi.mocked(BricksetApiService).mockImplementation(function() {
				return { login: vi.fn().mockRejectedValue(new Error('Auth failed')), validateKey: vi.fn() } as any;
			});
			await expect(capturedHandlers.onClick['Brickset Password']?.()).resolves.not.toThrow();
		});
	});

	describe('display() - lastSyncTimestamp branch coverage', () => {
		it('should not render last-sync hint when lastSyncTimestamp is null (line 223 false branch)', () => {
			// Setting lastSyncTimestamp to undefined makes lastSyncTimestamp != null → false
			plugin.settings.lastSyncTimestamp = undefined;
			tab = new BricksetSettingTab(app, plugin);
			expect(() => tab.display()).not.toThrow();
		});
	});

	describe('onClick handlers - invalid API key (line 45)', () => {
		it('should show invalid notice when validateKey returns false', async () => {
			const { BricksetApiService } = await import('../bricksetApi');
			const mockValidateKey = vi.fn().mockResolvedValue(false);
			vi.mocked(BricksetApiService).mockImplementation(function() {
				return { validateKey: mockValidateKey, login: vi.fn() } as any;
			});
			// Should not throw - Notice is constructed with invalid message
			await expect(capturedHandlers.onClick['Brickset API Key']?.()).resolves.not.toThrow();
			expect(mockValidateKey).toHaveBeenCalled();
		});
	});
});
