import type { Setting } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SupernoteSettingTab, SYNC_ENGINE_LABELS } from './settings';

vi.mock('obsidian', () => ({ PluginSettingTab: class PluginSettingTab {}, Setting: class Setting {} }));
vi.mock('./main', () => ({ default: class SupernotePlugin {} }));
vi.mock('./customDictionary', () => ({ CUSTOM_DICTIONARY_DEFAULT_SETTINGS: {} }));

describe('note viewer settings', () => {
    it('keeps the toggle first and hides the other viewer controls when disabled', async () => {
        const settings = { ...DEFAULT_SETTINGS };
        const saveSettings = vi.fn(async () => {});
        const loadedViewerEnabled = settings.noteViewerEnabled;
        const tab = new SupernoteSettingTab({} as never, {
            settings, saveSettings,
            isNoteViewerReloadRequired: () => settings.noteViewerEnabled !== loadedViewerEnabled,
        } as never);
        const update = vi.fn();
        Object.assign(tab, { update });
        const definitions = tab.getSettingDefinitions();
        const group = definitions.find((item) => 'heading' in item && item.heading === 'Note viewer');
        if (!group || !('items' in group)) throw new Error('Note viewer group missing');
        expect(SYNC_ENGINE_LABELS).toMatchObject({ 'ip-device': 'Direct IP', 'supernote-cloud': 'Supernote cloud' });
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
    ])('shows the appropriate actions for %s', (status, expectedButtons) => {
        const tab = new SupernoteSettingTab({} as never, {
            cloudSessionStatus: () => status,
        } as never);
        const group = tab.getSettingDefinitions().find((item) => 'heading' in item && item.heading === 'Supernote cloud');
        if (!group || !('items' in group)) throw new Error('Supernote cloud group missing');
        const session = group.items[0];
        if (!('render' in session) || !session.render) throw new Error('Cloud session renderer missing');

        const buttons: string[] = [];
        const setting = {
            setName: vi.fn().mockReturnThis(),
            setDesc: vi.fn().mockReturnThis(),
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
        expect(buttons).toEqual(expectedButtons);
    });
});