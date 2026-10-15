import { createCustomDictionarySettingsUI, createDictionaryTableUI, CUSTOM_DICTIONARY_DEFAULT_SETTINGS, CustomDictionarySettings } from "./customDictionary";
import SupernotePlugin from "./main";
import * as Obsidian from 'obsidian';
import { App, ExtraButtonComponent, Notice, PluginSettingTab, Setting } from 'obsidian';
import { SyncManifest } from './deviceSync';
import { SyncEngineId } from './syncAbstraction';
import { validateFileExtensionAllowlist } from './syncFilters';

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

export const SYNC_ENGINE_LABELS: Partial<Record<SyncEngineId, string>> = {
    'ip-device': 'Direct IP connection',
    'supernote-cloud': 'Supernote Cloud',
};

function validateSyncMinutes(value: string): string | undefined {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        return 'Enter a positive whole number of minutes';
    }
}

const SYNC_INTERVAL_DESCRIPTION = 'Minutes between automatic runs of the active sync engine.';
const SYNC_INTERVAL_WARNING = 'Intervals under 5 minutes may risk Cloud throttling; the service limit is unknown.';

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
    visible?: () => boolean;
    render: (setting: Setting) => void;
}
interface SettingDefinitionGroup {
    type: 'group';
    heading: string;
    items: SettingDefinitionItem[];
}
interface SettingDefinitionPage {
    type: 'page';
    name: string;
    visible?: () => boolean;
    page: () => { title: string; containerEl: HTMLElement; display(): void };
}
type SettingDefinitionItem = SettingDefinitionControl | SettingDefinitionRender | SettingDefinitionGroup | SettingDefinitionPage;

export interface SupernotePluginSettings extends CustomDictionarySettings {
    directConnectIP: string;
    invertColorsWhenDark: boolean;
    showExportButtons: boolean;
    /** Draw pen strokes as crisp vector paths instead of rasterizing the
     * ink layers — in the on-screen note view and exported PDFs. On by
     * default; turn off if ink renders incorrectly or differently from the
     * device. The persisted key stays `vectorInk` (originally PDF-only) so
     * existing installs keep their toggle state. */
    vectorInk: boolean;
    fileBrowserSortOrder: FileBrowserSortOrder;
    importFormat: ImportFormat;
    /** Format the note viewer's toolbar "export current page" button writes
     *  the page as. The command-palette "Export current page as PNG/SVG
     *  attachment" commands are unaffected — each always writes its own
     *  named format regardless of this setting. */
    pageExportImageFormat: PageExportImageFormat;
    /** Shared vault destination root used by the active sync engine. */
    syncFolder: string;
    /**
     * Device path glob patterns (comma/newline separated) scoping which
     * notes sync considers. Empty = sync everything. A single text field
     * rather than string[] because the declarative settings API's text
     * control only speaks in single strings — see parsePathFilters().
     */
    syncPathFiltersRaw: string;
    /** Shared comma/newline-separated extension allowlist. `*` includes all regular files. */
    syncFileExtensionsRaw: string;
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
    syncFileExtensionsRaw: '.note, .spd',
    noteSyncState: {},
	...CUSTOM_DICTIONARY_DEFAULT_SETTINGS,
}

export class SupernoteSettingTab extends PluginSettingTab {
    plugin: SupernotePlugin;

    constructor(app: App, plugin: SupernotePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private renderSyncInterval(setting: Setting): void {
        setting.setName('Interval').setDesc(SYNC_INTERVAL_DESCRIPTION);
        const validationEl = setting.descEl.createDiv({
            cls: 'supernote-sync-interval-validation',
        });
        validationEl.hidden = true;
        const warningEl = setting.descEl.createDiv({
            cls: 'supernote-sync-interval-warning',
            text: SYNC_INTERVAL_WARNING,
        });
        warningEl.hidden = this.plugin.getAutoSyncMinutes() >= 5;
        setting
            .addText((text) => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.inputEl.max = String(Number.MAX_SAFE_INTEGER);
                text.inputEl.step = '1';
                text.setValue(String(this.plugin.getAutoSyncMinutes())).onChange((value) => {
                    const error = validateSyncMinutes(value);
                    if (error) {
                        validationEl.setText(error);
                        validationEl.hidden = false;
                        return;
                    }
                    validationEl.empty();
                    validationEl.hidden = true;
                    const minutes = Number(value);
                    this.plugin.setAutoSyncMinutes(minutes);
                    warningEl.hidden = minutes >= 5;
                });
            });
    }

    // Declarative settings, so entries appear in Obsidian's settings search on 1.13.0+.
    // `display()` below stays as the fallback for this plugin's minAppVersion (< 1.13.0),
    // which is still called on those older versions.
    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'group',
                heading: 'UI',
                items: [
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
                        name: 'Vector ink',
                        desc: 'When on, the note viewer and PDF export draw pen strokes as crisp vector paths instead of rasterizing the ink. On by default; turn off if ink renders incorrectly or differently from the device.',
                        control: {
                            type: 'toggle',
                            key: 'vectorInk',
                        },
                    },
                ],
            },
            {
                type: 'group',
                heading: 'Convert',
                items: [
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
                        name: 'Enable custom dictionary',
                        render: (setting) => {
                            setting.setDesc('Replace recognized text when converting notes to Markdown. Raw files copied by sync engines are not modified.');
                            setting.descEl.appendText(' ');
                            const link = setting.descEl.createEl('a', { text: 'Edit dictionary entries', href: '#' });
                            const settings = (this.app as App & {
                                setting?: { openPagePath?: (id: string, path: string[]) => unknown };
                            }).setting;
                            link.hidden = !this.plugin.settings.isCustomDictionaryEnabled || !settings?.openPagePath;
                            link.addEventListener('click', (event) => {
                                event.preventDefault();
                                // Obsidian exposes native page navigation internally, but not in its public API.
                                settings?.openPagePath?.(this.plugin.manifest.id, ['Edit dictionary entries']);
                            });
                            setting.addToggle((toggle) => toggle
                                .setValue(this.plugin.settings.isCustomDictionaryEnabled)
                                .onChange(async (value) => {
                                    this.plugin.settings.isCustomDictionaryEnabled = value;
                                    link.hidden = !value || !settings?.openPagePath;
                                    (this as PluginSettingTab & { refreshDomState?: () => void }).refreshDomState?.();
                                    await this.plugin.saveSettings();
                                }));
                        },
                    },
                    {
                        type: 'page',
                        name: 'Edit dictionary entries',
                        visible: () => this.plugin.settings.isCustomDictionaryEnabled && !(
                            this.app as App & { setting?: { openPagePath?: unknown } }
                        ).setting?.openPagePath,
                        page: () => {
                            const SettingPage = (Obsidian as typeof Obsidian & {
                                SettingPage: new () => { title: string; containerEl: HTMLElement; display(): void };
                            }).SettingPage;
                            const plugin = this.plugin;
                            return new (class extends SettingPage {
                                constructor() {
                                    super();
                                    this.title = 'Custom dictionary';
                                }

                                display(): void {
                                    this.containerEl.empty();
                                    this.containerEl.addClass('supernote-settings-custom-dictionary');
                                    createDictionaryTableUI(this.containerEl, plugin);
                                }
                            })();
                        },
                    },
                ],
            },
            {
                type: 'group',
                heading: 'Date-based import',
                items: [
                    {
                        name: '',
                        render: (setting) => {
                            setting
                                .setName('')
                                .setDesc('Date-based import currently works only with the direct IP connection engine.');
                        },
                    },
                    {
                        name: 'Default format',
                        desc: 'Default format used when importing today\'s (or a chosen date\'s) pages via "import new or edited pages by date". Can also be changed per-import from the import dialog.',
                        control: {
                            type: 'dropdown',
                            key: 'importFormat',
                            options: IMPORT_FORMAT_LABELS,
                        },
                    },
                ],
            },
            {
                type: 'group',
                heading: 'Sync',
                items: [
                    {
                        name: 'Destination folder',
                        desc: 'Shared vault folder used by whichever sync engine is active. Synced source paths are mirrored below this folder.',
                        control: {
                            type: 'text',
                            key: 'syncFolder',
                            placeholder: 'Supernote sync',
                        },
                    },
                    {
                        name: 'Path allowlist',
                        desc: 'Limit sync to these source paths (comma or newline separated; supports * and ** wildcards, e.g. "/diary/**"). Leave empty to sync every supported file.',
                        control: {
                            type: 'text',
                            key: 'syncPathFiltersRaw',
                            placeholder: '/diary/**',
                        },
                    },
                    {
                        name: 'File extension allowlist',
                        desc: 'Comma- or newline-separated file extensions to sync, with or without a leading dot. Use * to include every trusted regular file. A blank value syncs no files.',
                        control: {
                            type: 'text',
                            key: 'syncFileExtensionsRaw',
                            placeholder: '.note, .spd',
                            validate: validateFileExtensionAllowlist,
                        },
                    },
                    {
                        name: 'Sync history',
                        render: (setting) => {
                            setting
                                .setDesc('Forgets which files sync has already managed. The next sync re-checks every matching file while preserving local-edit conflict protection.')
                                .addButton((btn) => {
                                    btn.setButtonText('Forget sync history').onClick(async () => {
                                        await this.plugin.clearActiveSyncHistory();
                                        new Notice('Sync history cleared');
                                    });
                                });
                        },
                    },
                    {
                        name: 'Sync engine',
                        render: (setting) => {
                            setting
                                .setDesc('Choose which sync engine is used for manual and scheduled sync.')
                                .addDropdown((dropdown) => {
                                    dropdown
                                        .addOptions(SYNC_ENGINE_LABELS)
                                        .setValue(this.plugin.getActiveSyncEngineId())
                                        .onChange(async (value) => {
                                            await this.plugin.setActiveSyncEngine(value as SyncEngineId);
                                        });
                                });
                        },
                    },
                    {
                        name: 'Automatic sync',
                        render: (setting) => {
                            setting.setDesc('Run the active sync engine on a schedule. Off by default.')
                                .addToggle((toggle) => toggle.setValue(this.plugin.isAutoSyncEnabled())
                                    .onChange((enabled) => {
                                        this.plugin.setAutoSyncEnabled(enabled);
                                        (this as PluginSettingTab & { update?: () => void }).update?.();
                                    }));
                        },
                    },
                    {
                        name: 'Interval',
                        visible: () => this.plugin.isAutoSyncEnabled(),
                        render: (setting) => this.renderSyncInterval(setting),
                    },
                ],
            },
            {
                type: 'group',
                heading: 'IP engine',
                items: [
                    {
                        name: 'Supernote IP address',
                        desc: 'The IP address used by Browse and Access, file transfer, screen mirroring, and the Direct IP sync engine. To find it, enable Screen Mirroring and/or Browse & Access on the Supernote device.',
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
                        name: 'Device file browser sort order',
                        desc: 'Default order to list files and folders in when browsing the supernote over a direct IP connection. Can also be changed from the browser itself.',
                        control: {
                            type: 'dropdown',
                            key: 'fileBrowserSortOrder',
                            options: FILE_BROWSER_SORT_LABELS,
                        },
                    },
                ],
            },
        ];
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.classList.add('supernote-settings-sections');
        let alert: ExtraButtonComponent;
        let extensionAlert: ExtraButtonComponent;

        const createSection = (heading: string): HTMLElement => {
            const group = containerEl.createDiv({ cls: 'setting-group' });
            new Setting(group).setName(heading).setHeading();
            return group.createDiv({ cls: 'setting-items' });
        };

        let sectionEl = createSection('UI');

        new Setting(sectionEl)
            .setName('Invert colors in "dark mode"')
            .setDesc('When Obsidian is in "dark mode" increase image visibility by inverting colors of images')
            .addToggle(text => text
                .setValue(this.plugin.settings.invertColorsWhenDark)
                .onChange(async (value) => {
                    this.plugin.settings.invertColorsWhenDark = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(sectionEl)
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

        new Setting(sectionEl)
            .setName('Vector ink')
            .setDesc(
                'When on, the note viewer and PDF export draw pen strokes as crisp vector paths instead of rasterizing the ink. On by default; turn off if ink renders incorrectly or differently from the device.',
            )
            .addToggle((text) =>
                text
                    .setValue(this.plugin.settings.vectorInk)
                    .onChange(async (value) => {
                        this.plugin.settings.vectorInk = value;
                        await this.plugin.saveSettings();
                    }),
            );

            sectionEl = createSection('Convert');

            new Setting(sectionEl)
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

        const customDictionarySetting = new Setting(sectionEl)
            .setName('Custom dictionary')
            .setDesc('You can add custom entries to fix errors in supernote\'s recognized text when it is converted to Markdown. Raw files copied by sync engines are not modified.');
        customDictionarySetting.settingEl.classList.add('supernote-settings-custom-dictionary-setting');
        createCustomDictionarySettingsUI(customDictionarySetting.settingEl, this.plugin);

        sectionEl = createSection('Date-based import');
        new Setting(sectionEl)
            .setDesc('Date-based import currently works only with the direct IP connection engine.');

        new Setting(sectionEl)
            .setName('Default format')
            .setDesc('Default format used when importing today\'s (or a chosen date\'s) pages via "import new or edited pages by date". Can also be changed per-import from the import dialog.')
            .addDropdown(dropdown => dropdown
                .addOptions(IMPORT_FORMAT_LABELS)
                .setValue(this.plugin.settings.importFormat)
                .onChange(async (value) => {
                    this.plugin.settings.importFormat = value as ImportFormat;
                    await this.plugin.saveSettings();
                })
            );

        sectionEl = createSection('Sync');

        new Setting(sectionEl)
            .setName('Destination folder')
            .setDesc('Shared vault folder used by whichever sync engine is active. Synced source paths are mirrored below this folder.')
            .addText(text => text
                .setPlaceholder('Supernote sync')
                .setValue(this.plugin.settings.syncFolder)
                .onChange(async (value) => {
                    this.plugin.settings.syncFolder = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(sectionEl)
            .setName('Path allowlist')
            .setDesc('Limit sync to these source paths (comma or newline separated; supports * and ** wildcards, e.g. "/diary/**"). Leave empty to sync every supported file.')
            .addText(text => text
                .setPlaceholder('/diary/**')
                .setValue(this.plugin.settings.syncPathFiltersRaw)
                .onChange(async (value) => {
                    this.plugin.settings.syncPathFiltersRaw = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(sectionEl)
            .setName('File extension allowlist')
            .setDesc('Comma- or newline-separated file extensions to sync, with or without a leading dot. Use * to include every trusted regular file. A blank value syncs no files.')
            .addText(text => text
                .setPlaceholder('.note, .spd')
                .setValue(this.plugin.settings.syncFileExtensionsRaw)
                .onChange(async (value) => {
                    const validationError = validateFileExtensionAllowlist(value);
                    extensionAlert.extraSettingsEl.toggleClass('supernote-settings-hidden', validationError === undefined);
                    if (validationError === undefined) {
                        this.plugin.settings.syncFileExtensionsRaw = value;
                        await this.plugin.saveSettings();
                    }
                })
            )
            .addExtraButton(btn => {
                btn.setIcon('alert-triangle')
                    .setTooltip('Enter extensions separated by commas or newlines, or * for all files');
                btn.extraSettingsEl.toggleClass('supernote-settings-hidden', true);
                extensionAlert = btn;
                return btn;
            });

        new Setting(sectionEl)
            .setName('Sync history')
            .setDesc('IP sync only. Cloud account binding and mirror history cannot be cleared in this milestone.')
            .addButton(btn => btn
                .setButtonText('Forget sync history')
                .onClick(async () => {
                    if (this.plugin.getActiveSyncEngineId() === 'supernote-cloud') {
                        new Notice('Cloud mirror history cannot be cleared while account binding is active');
                        return;
                    }
                    await this.plugin.clearActiveSyncHistory();
                    new Notice('Sync history cleared');
                })
            );

        new Setting(sectionEl)
            .setName('Sync engine')
            .setDesc('Choose which sync engine is used for manual and scheduled sync.')
            .addDropdown(dropdown => dropdown
                .addOptions(SYNC_ENGINE_LABELS)
                .setValue(this.plugin.getActiveSyncEngineId())
                .onChange(async (value) => {
                    await this.plugin.setActiveSyncEngine(value as SyncEngineId);
                })
            );

        let intervalSetting: Setting;
        new Setting(sectionEl)
            .setName('Automatic sync')
            .setDesc('Run the active sync engine on a schedule. Off by default.')
            .addToggle(toggle => toggle.setValue(this.plugin.isAutoSyncEnabled())
                .onChange((enabled) => {
                    this.plugin.setAutoSyncEnabled(enabled);
                    intervalSetting.settingEl.hidden = !enabled;
                }));
        intervalSetting = new Setting(sectionEl);
        this.renderSyncInterval(intervalSetting);
        intervalSetting.settingEl.hidden = !this.plugin.isAutoSyncEnabled();

        sectionEl = createSection('IP engine');

        new Setting(sectionEl)
            .setName('Supernote IP address')
            .setDesc('The IP address used by browse and access, file transfer, screen mirroring, and the direct IP sync engine. To find it, enable screen mirroring and/or browse & access on the supernote device.')
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
                alert = btn;
                return btn;
            });

        new Setting(sectionEl)
            .setName('Device file browser sort order')
            .setDesc('Default order to list files and folders in when browsing the supernote over a direct IP connection. Can also be changed from the browser itself.')
            .addDropdown(dropdown => dropdown
                .addOptions(FILE_BROWSER_SORT_LABELS)
                .setValue(this.plugin.settings.fileBrowserSortOrder)
                .onChange(async (value) => {
                    this.plugin.settings.fileBrowserSortOrder = value as FileBrowserSortOrder;
                    await this.plugin.saveSettings();
                })
            );

    }
}
