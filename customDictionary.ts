import { Setting } from "obsidian";
import SupernotePlugin from "./main";

type CustomDictionaryEntry = {
	src: string,
	replace: string,
}

export interface CustomDictionarySettings {
	isCustomDictionaryEnabled: boolean,
	customDictionary: CustomDictionaryEntry[]
}

export const CUSTOM_DICTIONARY_DEFAULT_SETTINGS: CustomDictionarySettings = {
	isCustomDictionaryEnabled: false,
	customDictionary: [],
}

function createDictionaryEntryUI({entry, tbody, plugin}: {entry: CustomDictionaryEntry, tbody: HTMLElement, plugin: SupernotePlugin}) {	
	const tr = tbody.createEl('tr');

	// Source Text Input
	const sourceTd = tr.createEl('td');
	const sourceInput = sourceTd.createEl('input');
	sourceInput.type = 'text';
	sourceInput.value = entry.src;

	// Replace Text Input
	const replaceTd = tr.createEl('td');
	const replaceInput = replaceTd.createEl('input');
	replaceInput.type = 'text';
	replaceInput.value = entry.replace;

	// Delete Button (in Options column)
	const optionsTd = tr.createEl('td');
	const deleteButton = optionsTd.createEl('button', { text: 'Delete' });

	// Update dictionary entry when input changes
	const updateDictionaryEntry = async () => {
		const index = Array.from(tbody.children).indexOf(tr)
		plugin.settings.customDictionary[index] = {
			src: sourceInput.value,
			replace: replaceInput.value
		};
		await plugin.saveSettings();
	}
	sourceInput.addEventListener('input', updateDictionaryEntry);
	replaceInput.addEventListener('input', updateDictionaryEntry);

	// Delete dictionary entry when delete button is clicked
	deleteButton.addEventListener('click', async () => {
		const index = Array.from(tbody.children).indexOf(tr);
		plugin.settings.customDictionary.splice(index, 1);
		await plugin.saveSettings();
		if (plugin.settings.customDictionary.length === 0) {
			sourceInput.value = '';
			replaceInput.value = '';
		} else {
			tr.remove();
		}
	});
}

function createDictionaryTableUI(containerEl: HTMLElement, plugin: SupernotePlugin) {
	const CONTAINER_CLASSNAME = 'supernote-settings-custom-dictionary-entries';

	// Remove existing dictionary entries to prepare for re-render
	containerEl.find(`.${CONTAINER_CLASSNAME}`)?.remove();

	const dictionaryEntriesContainer = containerEl.createDiv();

	dictionaryEntriesContainer
		.addClasses(['setting-item', CONTAINER_CLASSNAME]);

	dictionaryEntriesContainer.createDiv({ text: 'Custom Dictionary' })
		.addClass('setting-item-name');
	dictionaryEntriesContainer.createDiv({ text: 'Add an entry for every text string you would like to replace in the Supernote\'s recognized text. The plugin will match and replace text based on the order in the table, starting from the top and moving to the bottom. So, if you want a more specific text to be replaced first, make sure to add it at the top. This way, the plugin can fall back to less strict matching if needed.' })
		.addClasses(['setting-item-description']);

	const table = dictionaryEntriesContainer.createEl('table');
	const thead = table.createEl('thead');
	const trHead = thead.createEl('tr');
	const tbody = table.createEl('tbody');

	trHead.createEl('th', { text: 'Source Text' });
	trHead.createEl('th', { text: 'Replacement' });
	trHead.createEl('th', { text: 'Options' });


	const addEmptyRow = () => {
		createDictionaryEntryUI({
			entry: {src: '', replace: ''},
			tbody,
			plugin
		});
	}


	for (const entry of plugin.settings.customDictionary) {
		createDictionaryEntryUI({
			entry,
			tbody,
			plugin
		});
	}

	if (plugin.settings.customDictionary.length === 0) {
		addEmptyRow();
	}

	const addEntryButton = dictionaryEntriesContainer.createEl('button', { text: 'Add dictionary entry' });
	addEntryButton.addEventListener('click', addEmptyRow);
}

export function createCustomDictionarySettingsUI(containerEl: HTMLElement, plugin: SupernotePlugin): void {
	const customDictionaryContainer = containerEl.createDiv();
	customDictionaryContainer
		.addClasses(['supernote-settings-custom-dictionary']);
	customDictionaryContainer.createEl('h3', { text: 'Custom Dictionary' })
		// .addClass('setting-item-name');
	customDictionaryContainer.createDiv({ text: 'You can add custom entries to your dictionary to fix errors from Supernote\'s handwriting recognition. This also lets you automatically swap out certain text with your preferred wording, add special markdown characters, etc.' })
		.addClasses(['setting-item-description', 'supernote-settings-custom-dictionary-subtitle']);
		
		new Setting(customDictionaryContainer)
		.setName('Enable Custom Dictionary')
		.setDesc('Enable or disable the custom dictionary.')
		.addToggle(text => text
			.setValue(plugin.settings.isCustomDictionaryEnabled)
			.onChange(async (value) => {
				plugin.settings.isCustomDictionaryEnabled = value;
				await plugin.saveSettings();
			})
		);

		createDictionaryTableUI(customDictionaryContainer, plugin);
}

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceTextWithCustomDictionary(text: string, customDictionary: CustomDictionarySettings['customDictionary']): string {
	for (const entry of customDictionary) {
		const safeSrc = escapeRegExp(entry.src);
		const safeReplace = escapeRegExp(entry.replace);
		text = text.replace(new RegExp(safeSrc, 'g'), safeReplace);
	}
	return text;
}
