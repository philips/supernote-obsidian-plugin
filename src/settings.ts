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

export type AutoExportMode = 'markdown' | 'markdown-and-images';

export const AUTO_EXPORT_MODE_LABELS: Record<AutoExportMode, string> = {
    'markdown': 'Markdown only',
    'markdown-and-images': 'Markdown and images',
};

export interface SupernotePluginSettings extends CustomDictionarySettings {
    directConnectIP: string;
    invertColorsWhenDark: boolean;
    showExportButtons: boolean;
    noteImageMaxDim: number;
    fileBrowserSortOrder: FileBrowserSortOrder;
    autoExportEnabled: boolean;
    autoExportMode: AutoExportMode;
    // Vault-relative folder paths (one per line in the settings UI) that are
    // watched for .note files to auto-export. Empty by default: auto-export
    // is opt-in per folder, not vault-wide, so enabling the feature doesn't
    // immediately churn through every .note file already in the vault.
    autoExportWatchFolders: string[];
    // Where generated .md/.png files land. Empty means "alongside the source
    // .note file", matching the manual export commands' behavior.
    autoExportOutputFolder: string;
}

export const DEFAULT_SETTINGS: SupernotePluginSettings = {
    directConnectIP: '',
    invertColorsWhenDark: true,
    showExportButtons: true,
    noteImageMaxDim: 800, // Sensible default for Nomad pages to be legible but not too big. Unit: px
    fileBrowserSortOrder: 'name-asc',
    autoExportEnabled: false,
    autoExportMode: 'markdown-and-images',
    autoExportWatchFolders: [],
    autoExportOutputFolder: '',
	...CUSTOM_DICTIONARY_DEFAULT_SETTINGS,
}

export class SupernoteSettingTab extends PluginSettingTab {
    plugin: SupernotePlugin;

    constructor(app: App, plugin: SupernotePlugin) {
        super(app, plugin);
        this.plugin = plugin;
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
            .setName('Auto-export')
            .setHeading()
            .setDesc(
                'Automatically create/update markdown (and optionally images) in the vault whenever a .note file '
                + 'appears or changes in one of the watched folders below - e.g. a folder synced from your Supernote via '
                + 'OneDrive/Dropbox/a symlink. Leave the watch folder list empty to keep this off.',
            );

        new Setting(containerEl)
            .setName('Enable auto-export')
            .setDesc('Watch the folders below for new or changed .note files and export them automatically.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoExportEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.autoExportEnabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        if (this.plugin.settings.autoExportEnabled) {
            new Setting(containerEl)
                .setName('Watched folders')
                .setDesc('One vault-relative folder path per line. .note files inside these folders (including subfolders) are auto-exported.')
                .addTextArea(text => {
                    text.setPlaceholder('Supernote sync')
                        .setValue(this.plugin.settings.autoExportWatchFolders.join('\n'))
                        .onChange(async (value) => {
                            this.plugin.settings.autoExportWatchFolders = value
                                .split('\n')
                                .map(line => line.trim())
                                .filter(line => line.length > 0);
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.rows = 3;
                });

            new Setting(containerEl)
                .setName('Auto-export output')
                .setDesc('What to generate for each .note file.')
                .addDropdown(dropdown => dropdown
                    .addOptions(AUTO_EXPORT_MODE_LABELS)
                    .setValue(this.plugin.settings.autoExportMode)
                    .onChange(async (value) => {
                        this.plugin.settings.autoExportMode = value as AutoExportMode;
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName('Auto-export output folder')
                .setDesc('Vault-relative folder to write generated files to. Leave blank to write alongside each source .note file.')
                .addText(text => text
                    .setPlaceholder('(same folder as the .note file)')
                    .setValue(this.plugin.settings.autoExportOutputFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.autoExportOutputFolder = value.trim();
                        await this.plugin.saveSettings();
                    })
                );
        }

		// Add custom dictionary settings to the settings tab
		createCustomDictionarySettingsUI(containerEl, this.plugin);
    }
}
