import { Setting } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, markdownExportDestination, SupernoteSettingTab, validateMarkdownExportMappings } from './settings';
import { trimSyncLog } from './sync/syncReporting';

vi.mock('obsidian', () => {
    const element = (): unknown => ({ createDiv: element, empty: () => {}, setText: () => {} });
    return {
        PluginSettingTab: class PluginSettingTab {
            app: unknown;
            constructor(app: unknown) { this.app = app; }
        },
        Setting: class MockSetting {
            static buttons: { label: string; click: () => void | Promise<void> }[] = [];
            static texts: { name: string; change: (value: string) => void }[] = [];
            descEl = { createDiv: element };
            name = '';
            setName(name: string) { this.name = name; return this; }
            setDesc() { return this; }
            addToggle(configure: (toggle: unknown) => void) {
                configure({ setValue: () => ({ onChange: () => {} }) });
                return this;
            }
            addText(configure: (text: unknown) => void) {
                const input = {
                    setPlaceholder: () => input,
                    setValue: () => input,
                    onChange: (change: (value: string) => void) => { MockSetting.texts.push({ name: this.name, change }); },
                };
                configure(input);
                return this;
            }
            addButton(configure: (button: unknown) => void) {
                const input = {
                    setButtonText: (label: string) => {
                        const button: { label: string; click: () => void | Promise<void> } = { label, click: () => {} };
                        MockSetting.buttons.push(button);
                        return { onClick: (click: () => void | Promise<void>) => { button.click = click; } };
                    },
                };
                configure(input);
                return this;
            }
        },
    };
});
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

describe('automatic Markdown export settings', () => {
    const first = { id: 'first', enabled: true, watchDir: 'Notes', outputDir: 'Exports' };

    it('defaults off with independent error logging and no mappings', () => {
        expect(DEFAULT_SETTINGS.automaticMarkdownExportEnabled).toBe(false);
        expect(DEFAULT_SETTINGS.markdownExportErrorLogEnabled).toBe(true);
        expect(DEFAULT_SETTINGS.markdownExportMappings).toEqual([]);
    });

    it('rejects noncanonical paths, duplicate identities, overlapping watches and shared output roots', () => {
        expect(validateMarkdownExportMappings([{ ...first, watchDir: '../Notes' }])).toMatch(/Watch folder/);
        expect(validateMarkdownExportMappings([{ ...first, watchDir: 'C:/Notes' }])).toMatch(/Watch folder/);
        expect(validateMarkdownExportMappings([{ ...first, watchDir: 'Notes/ ' }])).toMatch(/Watch folder/);
        expect(validateMarkdownExportMappings([{ ...first, outputDir: '/Exports' }])).toMatch(/Output folder/);
        expect(validateMarkdownExportMappings([first, { ...first, enabled: false }])).toMatch(/unique ID/);
        expect(validateMarkdownExportMappings([first, { ...first, id: 'second', watchDir: 'Notes/Journal', outputDir: 'Other' }])).toMatch(/overlap/);
        expect(validateMarkdownExportMappings([first, { ...first, id: 'second', watchDir: 'Journal' }])).toMatch(/output folder/);
        expect(validateMarkdownExportMappings([first, { ...first, id: 'second', enabled: false, watchDir: 'Notes/Journal' }])).toBeUndefined();
        expect(validateMarkdownExportMappings([first, { ...first, id: 'second', watchDir: 'Journal', outputDir: '' }])).toBeUndefined();
    });

    it('keeps export controls separate from Convert and hides dependent rows when disabled', async () => {
        const settings = { ...DEFAULT_SETTINGS };
        const saveSettings = vi.fn(async () => {});
        const tab = new SupernoteSettingTab({} as never, { settings, saveSettings, ...engineRegistry } as never);
        const update = vi.fn();
        Object.assign(tab, { update });
        const groups = tab.getSettingDefinitions();
        const convert = groups.find((item) => 'heading' in item && item.heading === 'Convert');
        const exportGroup = groups.find((item) => 'heading' in item && item.heading === 'Automatic Markdown Export');
        if (!convert || !('items' in convert) || !exportGroup || !('items' in exportGroup)) {
            throw new Error('Conversion settings groups missing');
        }
        expect(convert.items.map((item) => 'name' in item && item.name)).toContain('Export current page as');
        expect(convert.items.map((item) => 'name' in item && item.name)).not.toContain('Watch and output folders');
        expect(exportGroup.items.map((item) => 'name' in item && item.name)).toEqual([
            'Enable automatic export', 'Markdown export error log', 'Watch and output folders',
        ]);
        const [enable, ...dependent] = exportGroup.items;
        expect(dependent.every((item) => 'visible' in item && item.visible?.() === false)).toBe(true);
        if (!('render' in enable)) throw new Error('Enable toggle missing');
        let changeEnabled: (enabled: boolean) => Promise<void> = async () => {};
        const toggle = {
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn((callback: typeof changeEnabled) => { changeEnabled = callback; }),
        };
        enable.render({
            setDesc: vi.fn().mockReturnThis(),
            addToggle: (configure: (component: typeof toggle) => void) => configure(toggle),
        } as unknown as Setting);
        expect(toggle.setValue).toHaveBeenCalledWith(false);
        await changeEnabled(true);
        expect(dependent.every((item) => 'visible' in item && item.visible?.() === true)).toBe(true);
        await changeEnabled(false);
        expect(dependent.every((item) => 'visible' in item && item.visible?.() === false)).toBe(true);
        expect(update).toHaveBeenCalledTimes(2);
        expect(saveSettings).toHaveBeenCalledTimes(2);
    });

    it('preserves the source directory when writing beside root or nested notes', () => {
        expect(markdownExportDestination({ ...first, outputDir: '' }, 'Notes/Journal/day.note'))
            .toBe('Notes/Journal/day.md');
        expect(markdownExportDestination({ ...first, watchDir: '', outputDir: '' }, 'day.note'))
            .toBe('day.md');
        expect(markdownExportDestination(first, 'Notes/Journal/day.note'))
            .toBe('Exports/Journal/day.md');
    });

    it('rejects folders occupied by files and sources that would overwrite an export log', () => {
        const occupied = { path: 'Exports', extension: 'md' };
        const app = { vault: {
            getAbstractFileByPath: (path: string) => path === 'Exports' ? occupied : null,
            getFiles: () => [],
        } } as never;
        expect(validateMarkdownExportMappings([first], app)).toMatch(/occupied by a file/);

        const logCollision = { vault: {
            getAbstractFileByPath: () => null,
            getFiles: () => [{ path: 'Notes/Markdown Export Log.note', extension: 'note' }],
        } } as never;
        expect(validateMarkdownExportMappings([{ ...first, outputDir: '' }], logCollision)).toBeUndefined();
        expect(validateMarkdownExportMappings([{ ...first, outputDir: 'Notes' }], logCollision))
            .toMatch(/export log/);
    });

    it('stages mapping edits until Save and refuses invalid drafts', async () => {
        const settings = { ...DEFAULT_SETTINGS, markdownExportMappings: [first] };
        const saveSettings = vi.fn(async () => {});
        const app = { vault: { getAbstractFileByPath: () => null, getFiles: () => [] } } as never;
        const tab = new SupernoteSettingTab(app, { settings, saveSettings, ...engineRegistry } as never);
        const group = tab.getSettingDefinitions().find((item) => 'heading' in item && item.heading === 'Automatic Markdown Export');
        if (!group || !('items' in group)) throw new Error('Automatic Markdown Export group missing');
        const editor = group.items.find((item) => 'name' in item && item.name === 'Watch and output folders');
        if (!editor || !('render' in editor)) throw new Error('Mapping editor missing');
        const controls = Setting as unknown as {
            buttons: { label: string; click: () => void | Promise<void> }[];
            texts: { name: string; change: (value: string) => void }[];
        };
        controls.buttons.length = 0;
        controls.texts.length = 0;
        editor.render(new Setting({} as never));
        controls.texts.find((text) => text.name === 'Watch folder')?.change('../unsafe');
        await controls.buttons.find((button) => button.label === 'Save pairs')?.click();
        expect(saveSettings).not.toHaveBeenCalled();
        expect(settings.markdownExportMappings).toEqual([first]);

        controls.texts.find((text) => text.name === 'Watch folder')?.change('Journal');
        await controls.buttons.find((button) => button.label === 'Save pairs')?.click();
        expect(settings.markdownExportMappings).toEqual([{ ...first, watchDir: 'Journal' }]);
        expect(saveSettings).toHaveBeenCalledOnce();
    });
});

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