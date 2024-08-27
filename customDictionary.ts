import SupernotePlugin from "./main";
import { randomUUID } from 'crypto';

type CustomDictionaryEntry = {
	src: string,
	replace: string,
}

export interface CustomDictionarySettings {
	isCustomDictionaryEnabled: boolean,
	customDictionary: Record<string, CustomDictionaryEntry>
}

export const CUSTOM_DICTIONARY_DEFAULT_SETTINGS: CustomDictionarySettings = {
	isCustomDictionaryEnabled: false,
	customDictionary: {},
}

function getDictionaryEntryId(): string {
	return randomUUID();
}

function createDictionaryEntryUI({id, entry, tbody, plugin}: {id: string, entry: CustomDictionaryEntry, tbody: HTMLElement, plugin: SupernotePlugin}) {	
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
		plugin.settings.customDictionary[id] = {src: sourceInput.value, replace: replaceInput.value};
		await plugin.saveSettings();
	}
	sourceInput.addEventListener('input', updateDictionaryEntry);
	replaceInput.addEventListener('input', updateDictionaryEntry);

	// Delete dictionary entry when delete button is clicked
	deleteButton.addEventListener('click', async () => {
		delete plugin.settings.customDictionary[sourceInput.value];
		await plugin.saveSettings();
		tr.remove();
	});
}

export function createCustomDictionarySettingsUI(containerEl: HTMLElement, plugin: SupernotePlugin): void {
	const customDictionaryContainer = containerEl.createDiv();
	customDictionaryContainer.createEl('hr');
	customDictionaryContainer.createEl('h2', { text: 'Custom Dictionary' });
	customDictionaryContainer.createEl('small', { text: 'You can add custom entries to your dictionary to fix errors from Supernote\'s handwriting recognition. This also lets you automatically swap out certain text with your preferred wording.' });

	const table = customDictionaryContainer.createEl('table');
	const thead = table.createEl('thead');
	const trHead = thead.createEl('tr');
	trHead.createEl('th', { text: 'Source Text' });
	trHead.createEl('th', { text: 'Replace Text' });
	trHead.createEl('th', { text: 'Options' });

	const tbody = table.createEl('tbody');

	const addEmptyRow = () => {
		createDictionaryEntryUI({
			id: getDictionaryEntryId(),
			entry: {src: '', replace: ''},
			tbody,
			plugin
		});
	}


	for (const [id, entry] of Object.entries(plugin.settings.customDictionary)) {
		createDictionaryEntryUI({
			id,
			entry,
			tbody,
			plugin
		});
	}

	if (Object.keys(plugin.settings.customDictionary).length === 0) {
		addEmptyRow();
	}

	const addEntryButton = customDictionaryContainer.createEl('button', { text: 'Add dictionary entry' });
	addEntryButton.addEventListener('click', addEmptyRow);
}
