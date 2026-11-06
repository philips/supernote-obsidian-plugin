import { Setting } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, markdownExportDestination, SupernoteSettingTab, validateMarkdownExportMappings } from './settings';
import { trimSyncLog } from './sync/syncReporting';

vi.mock('obsidian', () => {
    const element = (): unknown => ({ createDiv: element, createEl: element, empty: () => {}, setText: () => {}, hidden: false });
    return {
        TFolder: class TFolder { path = ''; },
        Modal: class MockModal {
            static current: MockModal;
            contentEl = element();
            app: unknown;
            constructor(app: unknown) { this.app = app; MockModal.current = this; }
            setTitle() {}
            open() { (this as unknown as { onOpen(): void }).onOpen(); }
            close() { (this as unknown as { onClose(): void }).onClose(); }
        },
        PluginSettingTab: class PluginSettingTab {
            app: unknown;
            constructor(app: unknown) { this.app = app; }
        },
        Setting: class MockSetting {
            static buttons: { label: string; disabled: boolean; click: () => void | Promise<void> }[] = [];
            static extraButtons: { name: string; click: () => void }[] = [];
            static toggles: { name: string; change: (enabled: boolean) => void | Promise<void> }[] = [];
            static texts: { name: string; change: (value: string) => void }[] = [];
            static dropdowns: { name: string; options: [string, string][]; change: (value: string) => void }[] = [];
            static names: string[] = [];
            descEl = { createDiv: element };
            name = '';
            setName(name: string) { this.name = name; MockSetting.names.push(name); return this; }
            setDesc() { return this; }
            addToggle(configure: (toggle: unknown) => void) {
                const toggle = { name: this.name, change: (_enabled: boolean): void | Promise<void> => {} };
                MockSetting.toggles.push(toggle);
                const input = {
                    setValue: () => input,
                    onChange: (change: (enabled: boolean) => void | Promise<void>) => { toggle.change = change; },
                };
                configure(input);
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
            addDropdown(configure: (dropdown: unknown) => void) {
                const dropdown = { name: this.name, options: [] as [string, string][], change: (_value: string) => {} };
                const input = {
                    addOption: (value: string, label: string) => { dropdown.options.push([value, label]); return input; },
                    onChange: (change: (value: string) => void) => { dropdown.change = change; },
                };
                MockSetting.dropdowns.push(dropdown);
                configure(input);
                return this;
            }
            addExtraButton(configure: (button: unknown) => void) {
                const button = { name: this.name, click: () => {} };
                MockSetting.extraButtons.push(button);
                const input = {
                    setIcon: () => input,
                    setTooltip: () => input,
                    onClick: (click: () => void) => { button.click = click; },
                };
                configure(input);
                return this;
            }
            addButton(configure: (button: unknown) => void) {
                const button = { label: '', disabled: false, click: (() => {}) as () => void | Promise<void> };
                MockSetting.buttons.push(button);
                const input = {
                    setButtonText: (label: string) => {
                        button.label = label;
                        return input;
                    },
                    setCta: () => input,
                    setDisabled: (disabled: boolean) => { button.disabled = disabled; return input; },
                    onClick: (click: () => void | Promise<void>) => { button.click = click; return input; },
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
        expect(validateMarkdownExportMappings([first, { ...first, id: 'second', name: '  ' }])).toMatch(/name/);
        expect(validateMarkdownExportMappings([{ ...first, name: 'a'.repeat(81) }])).toMatch(/80 characters/);
        expect(validateMarkdownExportMappings([{ ...first, name: 'Journal\nnotes' }])).toMatch(/control characters/);
        expect(validateMarkdownExportMappings([{ ...first, name: 'Journal\u007fnotes' }])).toMatch(/control characters/);
        expect(validateMarkdownExportMappings([{ ...first, name: 'Journal / notes' }])).toBeUndefined();
        expect(validateMarkdownExportMappings([{ ...first, name: 'Journal' }, { ...first, id: 'second', name: 'journal', watchDir: 'Other' }])).toMatch(/name/);
        expect(validateMarkdownExportMappings([first, { ...first, id: 'second', enabled: false }])).toMatch(/watch and output folders/);
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

    it('saves additions, removals and enabled changes immediately, but not cancelled dialogs', async () => {
        const namedFirst = { ...first, name: 'Existing' };
        const settings = { ...DEFAULT_SETTINGS, markdownExportMappings: [namedFirst] };
        const saveSettings = vi.fn(async () => {});
        const { TFolder, Modal } = await import('obsidian');
        const folder = (path: string) => Object.assign(new TFolder(), { path });
        const app = { vault: {
            getAbstractFileByPath: () => null, getFiles: () => [],
            getAllLoadedFiles: () => [folder('Notes'), folder('Journal'), folder('Exports')],
        } } as never;
        const tab = new SupernoteSettingTab(app, { settings, saveSettings, ...engineRegistry } as never);
        const group = tab.getSettingDefinitions().find((item) => 'heading' in item && item.heading === 'Automatic Markdown Export');
        if (!group || !('items' in group)) throw new Error('Automatic Markdown Export group missing');
        const editor = group.items.find((item) => 'name' in item && item.name === 'Watch and output folders');
        if (!editor || !('render' in editor)) throw new Error('Mapping editor missing');
        const controls = Setting as unknown as {
            buttons: { label: string; disabled: boolean; click: () => void | Promise<void> }[];
            texts: { name: string; change: (value: string) => void }[];
            dropdowns: { name: string; options: [string, string][]; change: (value: string) => void }[];
            names: string[];
            extraButtons: { name: string; click: () => void }[];
            toggles: { name: string; change: (enabled: boolean) => void | Promise<void> }[];
        };
        controls.buttons.length = 0;
        controls.texts.length = 0;
        controls.dropdowns.length = 0;
        controls.names.length = 0;
        controls.extraButtons.length = 0;
        controls.toggles.length = 0;
        editor.render(new Setting({} as never));
        const add = controls.buttons.find((button) => button.label === 'Add pair');
        const modal = Modal as unknown as { current: { close(): void } };
        const cancelled = add?.click();
        modal.current.close();
        await cancelled;
        expect(controls.buttons.filter((button) => button.label === 'Remove pair')).toHaveLength(0);
        expect(saveSettings).not.toHaveBeenCalled();
        expect(settings.markdownExportMappings).toEqual([namedFirst]);

        const added = add?.click();
        expect(controls.dropdowns.find((dropdown) => dropdown.name === 'Watch folder')?.options[0]).toEqual(['', '(Whole vault)']);
        expect(controls.dropdowns.find((dropdown) => dropdown.name === 'Output folder')?.options[0]).toEqual(['', '(Beside source)']);
        const name = controls.texts.slice().reverse().find((text) => text.name === 'Name');
        const watch = controls.dropdowns.slice().reverse().find((dropdown) => dropdown.name === 'Watch folder');
        const output = controls.dropdowns.slice().reverse().find((dropdown) => dropdown.name === 'Output folder');
        const ok = controls.buttons.slice().reverse().find((button) => button.label === 'OK');
        expect(ok?.disabled).toBe(true);
        name?.change('a'.repeat(81));
        expect(ok?.disabled).toBe(true);
        name?.change('Notes\nJournal');
        expect(ok?.disabled).toBe(true);
        name?.change(' existing ');
        expect(ok?.disabled).toBe(true);
        name?.change('Journal');
        watch?.change('Notes');
        output?.change('Exports');
        expect(ok?.disabled).toBe(true);
        watch?.change('Journal');
        expect(ok?.disabled).toBe(true);
        output?.change('');
        expect(ok?.disabled).toBe(false);
        await ok?.click();
        await added;
        expect(controls.names).toContain('Journal');
        expect(controls.buttons.some((button) => button.label === 'Save pairs')).toBe(false);
        expect(settings.markdownExportMappings).toEqual([namedFirst, expect.objectContaining({ name: 'Journal', watchDir: 'Journal', outputDir: '', enabled: true })]);
        expect(saveSettings).toHaveBeenCalledOnce();
        await controls.toggles.slice().reverse().find((toggle) => toggle.name === 'Journal')?.change(false);
        expect(settings.markdownExportMappings[1].enabled).toBe(false);
        expect(saveSettings).toHaveBeenCalledTimes(2);
        controls.extraButtons.slice().reverse().find((button) => button.name === 'Journal')?.click();
        await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(3));
        expect(settings.markdownExportMappings).toEqual([namedFirst]);
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