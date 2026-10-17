import type { Setting } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SupernoteSettingTab } from './settings';
import { trimSyncLog } from './sync/syncReporting';

vi.mock('obsidian', () => ({ PluginSettingTab: class PluginSettingTab {
    app: unknown;
    constructor(app: unknown) { this.app = app; }
}, Setting: class Setting {} }));
vi.mock('./main', () => ({ default: class SupernotePlugin {} }));
vi.mock('./customDictionary', () => ({ CUSTOM_DICTIONARY_DEFAULT_SETTINGS: {} }));
vi.mock('./sync/syncReporting', () => ({ trimSyncLog: vi.fn(async () => {}) }));

const engines = [
    { id: 'ip-device', name: 'Direct IP' },
    { id: 'supernote-cloud', name: 'Supernote cloud' },
] as const;
const engineRegistry = {
    getSyncEngines: () => engines,
    getSyncEngine: (id: string) => engines.find((engine) => engine.id === id),
};

describe('sync engine settings', () => {
    it('uses registered names for the dropdown and engine sections', () => {
        const renamed = [
            { id: 'ip-device', name: 'Renamed IP' },
            { id: 'supernote-cloud', name: 'Renamed cloud' },
        ];
        const tab = new SupernoteSettingTab({} as never, {
            getSyncEngines: () => renamed,
            getSyncEngine: (id: string) => renamed.find((engine) => engine.id === id),
            getActiveSyncEngineId: () => 'ip-device',
        } as never);
        const groups = tab.getSettingDefinitions().filter((item) => 'heading' in item);
        expect(groups.map((group) => 'heading' in group && group.heading)).toContain('Renamed IP');
        expect(groups.map((group) => 'heading' in group && group.heading)).toContain('Renamed cloud');
        const sync = groups.find((item) => 'heading' in item && item.heading === 'Sync');
        if (!sync || !('items' in sync)) throw new Error('Sync group missing');
        const engineSetting = sync.items.find((item) => 'name' in item && item.name === 'Sync engine');
        if (!engineSetting || !('render' in engineSetting)) throw new Error('Sync engine setting missing');
        const dropdown = { addOptions: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), onChange: vi.fn() };
        engineSetting.render({
            setDesc: vi.fn().mockReturnThis(),
            addDropdown: (configure: (component: typeof dropdown) => void) => configure(dropdown),
        } as unknown as Setting);
        expect(dropdown.addOptions).toHaveBeenCalledWith({ 'ip-device': 'Renamed IP', 'supernote-cloud': 'Renamed cloud' });
        expect(dropdown.setValue).toHaveBeenCalledWith('ip-device');
    });
});

describe('sync log settings', () => {
    it('defaults on, preserves the count while disabled, and trims on resumption and count changes', async () => {
        const settings = { ...DEFAULT_SETTINGS };
        const saveSettings = vi.fn(async () => {});
        const app = {} as never;
        const tab = new SupernoteSettingTab(app, { settings, saveSettings, ...engineRegistry } as never);
        const update = vi.fn();
        Object.assign(tab, { update });
        const group = tab.getSettingDefinitions().find((item) => 'heading' in item && item.heading === 'Sync');
        if (!group || !('items' in group)) throw new Error('Sync group missing');
        const toggle = group.items.find((item) => 'name' in item && item.name === 'Sync log');
        const count = group.items.find((item) => 'name' in item && item.name === 'History count');
        if (!toggle || !('render' in toggle) || !count || !('render' in count)) throw new Error('Log controls missing');
        expect(settings.syncLogEnabled).toBe(true);
        expect(settings.syncLogHistoryCount).toBe(8);

        let changeEnabled: (enabled: boolean) => Promise<void> = async () => {};
        const toggleComponent = {
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn((callback: typeof changeEnabled) => { changeEnabled = callback; }),
        };
        toggle.render({
            setDesc: vi.fn().mockReturnThis(),
            addToggle: (configure: (component: typeof toggleComponent) => void) => configure(toggleComponent),
        } as unknown as Setting);
        expect(toggleComponent.setValue).toHaveBeenCalledWith(true);
        await changeEnabled(false);
        expect(settings.syncLogHistoryCount).toBe(8);
        expect('visible' in count && count.visible?.()).toBe(false);
        expect(trimSyncLog).not.toHaveBeenCalled();
        await changeEnabled(true);
        expect(trimSyncLog).toHaveBeenCalledWith(app, settings.syncFolder, 8);
        expect('visible' in count && count.visible?.()).toBe(true);

        let changeCount: (value: string) => Promise<void> = async () => {};
        const input = { type: '', min: '', max: '', step: '' };
        const validation = { hidden: false, setText: vi.fn() };
        const textComponent = {
            inputEl: input,
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn((callback: typeof changeCount) => { changeCount = callback; }),
        };
        count.render({
            setName: vi.fn().mockReturnThis(),
            setDesc: vi.fn().mockReturnThis(),
            descEl: { createDiv: () => validation },
            addText: (configure: (component: typeof textComponent) => void) => configure(textComponent),
        } as unknown as Setting);
        expect(textComponent.setValue).toHaveBeenCalledWith('8');
        await changeCount('0');
        expect(validation.hidden).toBe(false);
        expect(settings.syncLogHistoryCount).toBe(8);
        await changeCount('3');
        expect(validation.hidden).toBe(true);
        expect(settings.syncLogHistoryCount).toBe(3);
        expect(trimSyncLog).toHaveBeenLastCalledWith(app, settings.syncFolder, 3);
        expect(saveSettings).toHaveBeenCalledTimes(3);
        expect(update).toHaveBeenCalledTimes(2);
    });
});

describe('note viewer settings', () => {
    it('keeps the toggle first and hides the other viewer controls when disabled', async () => {
        const settings = { ...DEFAULT_SETTINGS };
        const saveSettings = vi.fn(async () => {});
        const loadedViewerEnabled = settings.noteViewerEnabled;
        const tab = new SupernoteSettingTab({} as never, {
            settings, saveSettings, ...engineRegistry,
            isNoteViewerReloadRequired: () => settings.noteViewerEnabled !== loadedViewerEnabled,
        } as never);
        const update = vi.fn();
        Object.assign(tab, { update });
        const definitions = tab.getSettingDefinitions();
        const group = definitions.find((item) => 'heading' in item && item.heading === 'Note viewer');
        if (!group || !('items' in group)) throw new Error('Note viewer group missing');
        expect(definitions.some((item) => 'heading' in item && item.heading === 'Supernote cloud')).toBe(true);

        expect(group.items.map((item) => 'name' in item ? item.name : '')).toEqual([
            'Enable note viewer', 'Invert colors in "dark mode"', 'Show export buttons', 'Vector ink',
        ]);
        const remaining = group.items.slice(1);
        expect(remaining.every((item) => 'visible' in item && item.visible?.() === true)).toBe(true);

        const toggle = group.items[0];
        if (!('render' in toggle) || !toggle.render) throw new Error('Viewer toggle missing');
        let onChange: ((enabled: boolean) => Promise<void>) | undefined;
        const component = {
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn((callback: (enabled: boolean) => Promise<void>) => { onChange = callback; }),
        };
        const warning = { hidden: false };
        const row = {
            setDesc: vi.fn().mockReturnThis(),
            descEl: { createDiv: vi.fn(() => warning) },
            addToggle: vi.fn((callback: (toggle: typeof component) => void) => callback(component)),
        };
        toggle.render(row as unknown as Setting);
        expect(row.setDesc).toHaveBeenCalledWith('The viewer can be disabled for compatibility with other plugins.');
        expect(row.descEl.createDiv).toHaveBeenCalledWith({
            cls: 'supernote-sync-interval-warning',
            text: 'Obsidian or this plugin must be reloaded for changes to this setting to take effect.',
        });
        expect(warning.hidden).toBe(true);
        expect(component.setValue).toHaveBeenCalledWith(true);
        if (!onChange) throw new Error('Viewer toggle change handler missing');
        await onChange(false);
        expect(saveSettings).toHaveBeenCalledOnce();
        expect(update).toHaveBeenCalledOnce();
        expect(remaining.every((item) => 'visible' in item && item.visible?.() === false)).toBe(true);
        expect(settings.noteViewerEnabled).toBe(false);
        toggle.render(row as unknown as Setting);
        expect(warning.hidden).toBe(false);
        await onChange(true);
        toggle.render(row as unknown as Setting);
        expect(warning.hidden).toBe(true);
    });
});

describe('Cloud session settings', () => {
    it.each([
        ['Signed in', ['Sign out']],
        ['Sign in required', ['Sign in']],
        ['Cloud session storage is invalid', ['Sign out']],
        ['SecretStorage is unavailable', []],
    ])('shows the appropriate actions for %s', async (status, expectedButtons) => {
        const cloudSessionUsername = vi.fn(async () => 'Example user');
        const tab = new SupernoteSettingTab({} as never, {
            ...engineRegistry, cloudSessionStatus: () => status,
            cloudSessionUsername,
        } as never);
        const group = tab.getSettingDefinitions().find((item) => 'heading' in item && item.heading === 'Supernote cloud');
        if (!group || !('items' in group)) throw new Error('Supernote cloud group missing');
        const session = group.items[0];
        if (!('render' in session) || !session.render) throw new Error('Cloud session renderer missing');

        const buttons: string[] = [];
        const setting = {
            setName: vi.fn().mockReturnThis(),
            setDesc: vi.fn().mockReturnThis(),
            descEl: { isConnected: true },
            addButton: vi.fn((configure: (button: { setButtonText: (text: string) => unknown; onClick: () => unknown }) => void) => {
                const button = {
                    setButtonText: (text: string) => { buttons.push(text); return button; },
                    onClick: () => button,
                };
                configure(button);
            }),
        };
        session.render(setting as unknown as Setting);
        expect(setting.setDesc).toHaveBeenCalledWith(status);
        await Promise.resolve();
        if (status === 'Signed in') {
            expect(cloudSessionUsername).toHaveBeenCalledOnce();
            expect(setting.setDesc).toHaveBeenLastCalledWith('Signed in as Example user');
        } else {
            expect(cloudSessionUsername).not.toHaveBeenCalled();
        }
        expect(buttons).toEqual(expectedButtons);
    });

    it('does not show a stale username after sign-out while the lookup is pending', async () => {
        let resolveUsername: ((value: string) => void) | undefined;
        const cloudSessionUsername = vi.fn(() => new Promise<string>((resolve) => { resolveUsername = resolve; }));
        let status = 'Signed in';
        const tab = new SupernoteSettingTab({} as never, {
            ...engineRegistry, cloudSessionStatus: () => status, cloudSessionUsername,
        } as never);
        const group = tab.getSettingDefinitions().find((item) => 'heading' in item && item.heading === 'Supernote cloud');
        if (!group || !('items' in group)) throw new Error('Supernote cloud group missing');
        const session = group.items[0];
        if (!('render' in session) || !session.render) throw new Error('Cloud session renderer missing');
        const setting = {
            setName: vi.fn().mockReturnThis(),
            setDesc: vi.fn().mockReturnThis(),
            descEl: { isConnected: true },
            addButton: vi.fn(),
        };
        session.render(setting as unknown as Setting);
        status = 'Sign in required';
        resolveUsername?.('Former user');
        await Promise.resolve();
        expect(setting.setDesc).toHaveBeenCalledOnce();
        expect(setting.setDesc).toHaveBeenCalledWith('Signed in');
    });
});