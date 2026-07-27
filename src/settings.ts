import { createCustomDictionarySettingsUI, CUSTOM_DICTIONARY_DEFAULT_SETTINGS, CustomDictionarySettings } from "./customDictionary";
import SupernotePlugin from "./main";
import { App, ExtraButtonComponent, PluginSettingTab, Setting } from 'obsidian';

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
    'note-link': 'Note link (save .note file, link to it)',
    'embed': 'Embedded note (save .note file, embed it)',
    'images': 'Images only',
    'pdf': 'PDF',
    'images-text': 'Images and text',
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
    noteImageMaxDim: number;
    fileBrowserSortOrder: FileBrowserSortOrder;
    importFormat: ImportFormat;
    isKeywordsAndLinksEnabled: boolean;
}

export const DEFAULT_SETTINGS: SupernotePluginSettings = {
    directConnectIP: '',
    invertColorsWhenDark: true,
    showExportButtons: false,
    noteImageMaxDim: 800, // Sensible default for Nomad pages to be legible but not too big. Unit: px
    fileBrowserSortOrder: 'name-asc',
    importFormat: 'images-text',
    isKeywordsAndLinksEnabled: true,
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
                name: 'Max image side length in .note files',
                desc: 'Maximum width and height (in pixels) of the note image when viewing .note files. Does not affect exported images and markdown.',
                control: {
                    type: 'slider',
                    key: 'noteImageMaxDim',
                    min: 200,
                    max: 1900,
                    step: 100, // Resolution of an A5X/A6X2/Nomad page is 1404 x 1872 px (with no upscaling)
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
                name: 'Convert supernote keywords to tags and links to wikilinks',
                desc: 'In exported markdown, turn starred keywords into Obsidian tags (e.g. #my_tag) and supernote internal links into wikilinks (e.g. [[note#page 1]]).',
                control: {
                    type: 'toggle',
                    key: 'isKeywordsAndLinksEnabled',
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
            .setName('Max image side length in .note files')
            .setDesc('Maximum width and height (in pixels) of the note image when viewing .note files. Does not affect exported images and markdown.')
            .addSlider(text => text
                .setLimits(200, 1900, 100) // Resolution of an A5X/A6X2/Nomad page is 1404 x 1872 px (with no upscaling)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.noteImageMaxDim)
                .onChange(async (value) => {
                    this.plugin.settings.noteImageMaxDim = value;
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
            .setName('Convert supernote keywords to tags and links to wikilinks')
            .setDesc('In exported markdown, turn starred keywords into Obsidian tags (e.g. #my_tag) and supernote internal links into wikilinks (e.g. [[note#page 1]]).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.isKeywordsAndLinksEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.isKeywordsAndLinksEnabled = value;
                    await this.plugin.saveSettings();
                })
            );

		// Add custom dictionary settings to the settings tab
		createCustomDictionarySettingsUI(containerEl, this.plugin);
    }
}
