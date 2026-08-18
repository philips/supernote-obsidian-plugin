import { createCustomDictionarySettingsUI, CUSTOM_DICTIONARY_DEFAULT_SETTINGS, CustomDictionarySettings } from "./customDictionary";
import SupernotePlugin from "./main";
import { App, ExtraButtonComponent, Notice, PluginSettingTab, Setting } from 'obsidian';
import { SyncManifest } from './deviceSync';

export const IP_VALIDATION_PATTERN = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

export type FileBrowserSortOrder = 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc';

export const FILE_BROWSER_SORT_LABELS: Record<FileBrowserSortOrder, string> = {
    'name-asc': 'Name (A to Z)',
    'name-desc': 'Name (Z to A)',
    'date-desc': 'Date (newest first)',
    'date-asc': 'Date (oldest first)',
};

export type ImportFormat = 'note-link' | 'embed' | 'images' | 'pdf' | 'images-text';

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
    'note-link': 'Original file (save .note/.spd, link to it)',
    'embed': 'Embedded original file (save .note/.spd file, embed it)',
    'images': 'Images only',
    'pdf': 'PDF',
    'images-text': 'Images and text (text only available for .note)',
};

export type PageExportImageFormat = 'png' | 'svg';

export const PAGE_EXPORT_IMAGE_FORMAT_LABELS: Record<PageExportImageFormat, string> = {
    png: 'PNG',
    svg: 'SVG',
};

// Obsidian's declarative settings API (1.13+): PluginSettingTab.getSettingDefinitions().
// Not present in the `obsidian` devDependency's types (pinned pre-1.13, see CLAUDE.md on
// why this repo can't casually bump it), so the shapes below are hand-typed to match the
// real runtime API rather than pulled in from the package.
interface SettingControlBase<V> {
    key: string;
    validate?: (value: V) => string | void;
}
interface SettingTextControl extends SettingControlBase<string> {
    type: 'text';
    placeholder?: string;
}
interface SettingToggleControl extends SettingControlBase<boolean> {
    type: 'toggle';
}
interface SettingSliderControl extends SettingControlBase<number> {
    type: 'slider';
    min: number;
    max: number;
    step: number;
}
interface SettingDropdownControl extends SettingControlBase<string> {
    type: 'dropdown';
    options: Record<string, string>;
}
type SettingControl = SettingTextControl | SettingToggleControl | SettingSliderControl | SettingDropdownControl;
interface SettingDefinitionControl {
    name: string;
    desc?: string;
    control: SettingControl;
}
interface SettingDefinitionRender {
    name: string;
    render: (setting: Setting) => void;
}
type SettingDefinitionItem = SettingDefinitionControl | SettingDefinitionRender;

export interface SupernotePluginSettings extends CustomDictionarySettings {
    directConnectIP: string;
    invertColorsWhenDark: boolean;
    showExportButtons: boolean;
    /** Draw exported-PDF pen strokes as crisp vector paths instead of
     * rasterizing the ink layers. On by default; turn off if an exported
     * PDF renders ink incorrectly or differently from the device. */
    vectorInk: boolean;
    fileBrowserSortOrder: FileBrowserSortOrder;
    importFormat: ImportFormat;
    /** Format the note viewer's toolbar "export current page" button writes
     *  the page as. The command-palette "Export current page as PNG/SVG
     *  attachment" commands are unaffected — each always writes its own
     *  named format regardless of this setting. */
    pageExportImageFormat: PageExportImageFormat;
    /** Vault folder that device sync writes into; never touches anything outside it. */
    syncFolder: string;
    /**
     * Device path glob patterns (comma/newline separated) scoping which
     * notes sync considers. Empty = sync everything. A single text field
     * rather than string[] because the declarative settings API's text
     * control only speaks in single strings — see parsePathFilters().
     */
    syncPathFiltersRaw: string;
    /**
     * Persisted record of what sync last wrote for each device note — see
     * deviceSync.ts. Drives both change detection (skip unchanged files) and
     * the overwrite-safety guard (never clobber a local edit).
     */
    noteSyncState: SyncManifest;
}

export const DEFAULT_SETTINGS: SupernotePluginSettings = {
    directConnectIP: '',
    invertColorsWhenDark: true,
    showExportButtons: false,
    vectorInk: true,
    fileBrowserSortOrder: 'name-asc',
    importFormat: 'images-text',
    pageExportImageFormat: 'png',
    syncFolder: 'Supernote sync',
    syncPathFiltersRaw: '',
    noteSyncState: {},
	...CUSTOM_DICTIONARY_DEFAULT_SETTINGS,
}

export class SupernoteSettingTab extends PluginSettingTab {
    plugin: SupernotePlugin;

    constructor(app: App, plugin: SupernotePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // Declarative settings, so entries appear in Obsidian's settings search on 1.13.0+.
    // `display()` below stays as the fallback for this plugin's minAppVersion (< 1.13.0),
    // which is still called on those older versions.
    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: 'Supernote IP address',
                desc: '(Optional) when using the supernote "browse and access" for document upload/download or "screen mirroring" screenshot attachment this is the IP of the supernote device',
                control: {
                    type: 'text',
                    key: 'directConnectIP',
                    placeholder: 'IP only e.g. 192.168.1.2',
                    validate: (value) => {
                        if (value !== '' && !IP_VALIDATION_PATTERN.test(value)) {
                            return 'Invalid IP format: must be xxx.xxx.xxx.xxx';
                        }
                    },
                },
            },
            {
                name: 'Invert colors in "dark mode"',
                desc: 'When Obsidian is in "dark mode" increase image visibility by inverting colors of images',
                control: {
                    type: 'toggle',
                    key: 'invertColorsWhenDark',
                },
            },
            {
                name: 'Show export buttons',
                desc: 'When viewing .note files, show buttons for exporting images and/or markdown files to vault. These features can still be accessed via the command pallete.',
                control: {
                    type: 'toggle',
                    key: 'showExportButtons',
                },
            },
            {
                name: 'Vector ink in PDF export',
                desc: 'When on, an exported PDF draws pen strokes as crisp vector paths instead of rasterizing the ink. On by default; turn off if an exported PDF renders ink incorrectly or differently from the device.',
                control: {
                    type: 'toggle',
                    key: 'vectorInk',
                },
            },
            {
                name: 'Export current page as',
                desc: 'Format the note viewer toolbar\'s page-export button saves the page as. The command palette\'s PNG/SVG-specific export commands are unaffected by this setting.',
                control: {
                    type: 'dropdown',
                    key: 'pageExportImageFormat',
                    options: PAGE_EXPORT_IMAGE_FORMAT_LABELS,
                },
            },
            {
                name: 'Device file browser sort order',
                desc: 'Default order to list files and folders in when browsing the supernote device (e.g. "attach supernote file from device"). Can also be changed from the browser itself.',
                control: {
                    type: 'dropdown',
                    key: 'fileBrowserSortOrder',
                    options: FILE_BROWSER_SORT_LABELS,
                },
            },
            {
                name: 'Default import format',
                desc: 'Default format used when importing today\'s (or a chosen date\'s) pages via "import new or edited pages by date". Can also be changed per-import from the import dialog.',
                control: {
                    type: 'dropdown',
                    key: 'importFormat',
                    options: IMPORT_FORMAT_LABELS,
                },
            },
            {
                name: 'Sync',
                render: (setting) => {
                    setting.setHeading();
                },
            },
            {
                name: 'Sync folder',
                desc: 'Vault folder that "sync supernote notes now" writes into, mirroring the device\'s own folder structure underneath it (including a "Sync Log.md" recording any conflicts or errors). The sync command never writes anywhere outside this folder.',
                control: {
                    type: 'text',
                    key: 'syncFolder',
                    placeholder: 'Supernote sync',
                },
            },
            {
                name: 'Sync device paths',
                desc: 'Limit sync to these device paths (comma or newline separated; supports * and ** wildcards, e.g. "/diary/**"). Leave empty to sync every note on the device.',
                control: {
                    type: 'text',
                    key: 'syncPathFiltersRaw',
                    placeholder: '/diary/**',
                },
            },
            {
                name: 'Sync history',
                render: (setting) => {
                    setting
                        .setDesc('Forgets which device notes have already been synced. The next sync re-checks every matching note from scratch — already-synced files are still protected by the same edit-conflict check, so this is safe to use, just slower for one run.')
                        .addButton((btn) => {
                            btn.setButtonText('Forget sync history').onClick(async () => {
                                this.plugin.settings.noteSyncState = {};
                                await this.plugin.saveSettings();
                                new Notice('Supernote sync history cleared');
                            });
                        });
                },
            },
            {
                name: 'Custom dictionary',
                render: (setting) => {
                    createCustomDictionarySettingsUI(setting.settingEl, this.plugin);
                },
            },
        ];
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        let alert: ExtraButtonComponent;

        new Setting(containerEl)
            .setName('Supernote IP address')
            .setDesc('(Optional) when using the supernote "browse and access" for document upload/download or "screen mirroring" screenshot attachment this is the IP of the supernote device')
            .addText(text => text
                .setPlaceholder('IP only e.g. 192.168.1.2')
                .setValue(this.plugin.settings.directConnectIP)
                .onChange(async (value) => {
                    if (IP_VALIDATION_PATTERN.test(value) || value === '') {
                        this.plugin.settings.directConnectIP = value;
                        alert.extraSettingsEl.toggleClass('supernote-settings-hidden', true);
                        await this.plugin.saveSettings();
                    } else {
                        alert.extraSettingsEl.toggleClass('supernote-settings-hidden', false);
                    }
                })
                .inputEl.setAttribute('pattern', IP_VALIDATION_PATTERN.source)
            )
            .addExtraButton(btn => {
                btn.setIcon('alert-triangle')
                    .setTooltip('Invalid IP format: must be xxx.xxx.xxx.xxx');
                btn.extraSettingsEl.toggleClass('supernote-settings-hidden', true);
                alert = btn
                return btn;
            });

        new Setting(containerEl)
            .setName('Invert colors in "dark mode"')
            .setDesc('When Obsidian is in "dark mode" increase image visibility by inverting colors of images')
            .addToggle(text => text
                .setValue(this.plugin.settings.invertColorsWhenDark)
                .onChange(async (value) => {
                    this.plugin.settings.invertColorsWhenDark = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Show export buttons')
            .setDesc(
                'When viewing .note files, show buttons for exporting images and/or markdown files to vault. These features can still be accessed via the command pallete.',
            )
            .addToggle((text) =>
                text
                    .setValue(this.plugin.settings.showExportButtons)
                    .onChange(async (value) => {
                        this.plugin.settings.showExportButtons = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName('Vector ink in PDF export')
            .setDesc(
                'When on, an exported PDF draws pen strokes as crisp vector paths instead of rasterizing the ink. On by default; turn off if an exported PDF renders ink incorrectly or differently from the device.',
            )
            .addToggle((text) =>
                text
                    .setValue(this.plugin.settings.vectorInk)
                    .onChange(async (value) => {
                        this.plugin.settings.vectorInk = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName('Export current page as')
            .setDesc('Format the note viewer toolbar\'s page-export button saves the page as. The command palette\'s PNG/SVG-specific export commands are unaffected by this setting.')
            .addDropdown(dropdown => dropdown
                .addOptions(PAGE_EXPORT_IMAGE_FORMAT_LABELS)
                .setValue(this.plugin.settings.pageExportImageFormat)
                .onChange(async (value) => {
                    this.plugin.settings.pageExportImageFormat = value as PageExportImageFormat;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Device file browser sort order')
            .setDesc('Default order to list files and folders in when browsing the supernote device (e.g. "attach supernote file from device"). Can also be changed from the browser itself.')
            .addDropdown(dropdown => dropdown
                .addOptions(FILE_BROWSER_SORT_LABELS)
                .setValue(this.plugin.settings.fileBrowserSortOrder)
                .onChange(async (value) => {
                    this.plugin.settings.fileBrowserSortOrder = value as FileBrowserSortOrder;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Default import format')
            .setDesc('Default format used when importing today\'s (or a chosen date\'s) pages via "import new or edited pages by date". Can also be changed per-import from the import dialog.')
            .addDropdown(dropdown => dropdown
                .addOptions(IMPORT_FORMAT_LABELS)
                .setValue(this.plugin.settings.importFormat)
                .onChange(async (value) => {
                    this.plugin.settings.importFormat = value as ImportFormat;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Sync')
            .setHeading();

        new Setting(containerEl)
            .setName('Sync folder')
            .setDesc('Vault folder that "sync supernote notes now" writes into, mirroring the device\'s own folder structure underneath it (including a "Sync Log.md" recording any conflicts or errors). The sync command never writes anywhere outside this folder.')
            .addText(text => text
                .setPlaceholder('Supernote sync')
                .setValue(this.plugin.settings.syncFolder)
                .onChange(async (value) => {
                    this.plugin.settings.syncFolder = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Sync device paths')
            .setDesc('Limit sync to these device paths (comma or newline separated; supports * and ** wildcards, e.g. "/diary/**"). Leave empty to sync every note on the device.')
            .addText(text => text
                .setPlaceholder('/diary/**')
                .setValue(this.plugin.settings.syncPathFiltersRaw)
                .onChange(async (value) => {
                    this.plugin.settings.syncPathFiltersRaw = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Sync history')
            .setDesc('Forgets which device notes have already been synced. The next sync re-checks every matching note from scratch — already-synced files are still protected by the same edit-conflict check, so this is safe to use, just slower for one run.')
            .addButton(btn => btn
                .setButtonText('Forget sync history')
                .onClick(async () => {
                    this.plugin.settings.noteSyncState = {};
                    await this.plugin.saveSettings();
                    new Notice('Supernote sync history cleared');
                })
            );

		// Add custom dictionary settings to the settings tab
		createCustomDictionarySettingsUI(containerEl, this.plugin);
    }
}
