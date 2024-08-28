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
		tr.remove();
	});
}

function createDictionaryTableUI(containerEl: HTMLElement, plugin: SupernotePlugin) {
	const CONTAINER_CLASSNAME = 'supernote-settings-custom-dictionary-entries';

	// Remove existing dictionary entries to prepare for re-render
	containerEl.find(`.${CONTAINER_CLASSNAME}`)?.remove();

	const dictionaryEntriesContainer = containerEl.createDiv();
	const table = dictionaryEntriesContainer.createEl('table');
	const thead = table.createEl('thead');
	const trHead = thead.createEl('tr');
	const tbody = table.createEl('tbody');

	dictionaryEntriesContainer.addClass(CONTAINER_CLASSNAME);
	trHead.createEl('th', { text: 'Source Text' });
	trHead.createEl('th', { text: 'Replace Text' });
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
		.addClasses(['setting-item', 'supernote-settings-custom-dictionary']);
	customDictionaryContainer.createDiv({ text: 'Custom Dictionary' })
		.addClass('setting-item-name');
	customDictionaryContainer.createDiv({ text: 'You can add custom entries to your dictionary to fix errors from Supernote\'s handwriting recognition. This also lets you automatically swap out certain text with your preferred wording.' })
		.addClass('setting-item-description');

	createDictionaryTableUI(customDictionaryContainer, plugin);
}

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceTextWithCustomDictionary(text: string, customDictionary: Record<string, CustomDictionaryEntry>): string {
	for (const entry of Object.values(customDictionary)) {
		const safeSrc = escapeRegExp(entry.src);
		const safeReplace = escapeRegExp(entry.replace);
		text = text.replace(new RegExp(safeSrc, 'g'), safeReplace);
	}
	return text;
}
