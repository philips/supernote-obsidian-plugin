import { setIcon, Setting } from "obsidian";
import SupernotePlugin from "./main";

/** Custom dictionary entry type */
type CustomDictionaryEntry = {
	/** The source text from Supernote .note file */
	source: string,
	/** String to replace if the source text is matched */
	replace: string,
	/** Whether the source text should be matched case-sensitively */
	matchCase?: boolean,
	/** Whether the source text should be matched as a whole word */
	matchWord?: boolean
}

/** Settings for Supernote's plugin custom dictionary options */
export interface CustomDictionarySettings {
	/** Whether the custom dictionary is enabled and text replacement should occur when extracting text to Obsidian  */
	isCustomDictionaryEnabled: boolean,
	/** The custom dictionary entries */
	customDictionary: CustomDictionaryEntry[]
}

export const CUSTOM_DICTIONARY_DEFAULT_SETTINGS: CustomDictionarySettings = {
	isCustomDictionaryEnabled: false,
	customDictionary: [],
}

// Create the UI for a single dictionary entry
function createDictionaryEntryUI({entry, tbody, plugin}: {entry: CustomDictionaryEntry, tbody: HTMLElement, plugin: SupernotePlugin}) {	
	const tr = tbody.createEl('tr');

	// Create source text input
	const sourceTd = tr.createEl('td');
	const sourceInput = sourceTd.createEl('input');
	sourceInput.type = 'text';
	sourceInput.value = entry.source;

	// Create replace text input
	const replaceTd = tr.createEl('td');
	const replaceInput = replaceTd.createEl('input');
	replaceInput.type = 'text';
	replaceInput.value = entry.replace;

	// Create dictionary entry options
	const optionsTd = tr.createEl('td');
	const matchCaseButton = optionsTd.createEl('button');
		matchCaseButton.ariaLabel = 'Match case';
		setIcon(matchCaseButton, 'case-sensitive');
		if (entry.matchCase !== false) {
			matchCaseButton.addClass('active');
		}
	const matchWordButton = optionsTd.createEl('button');
		matchWordButton.ariaLabel = 'Match whole word';
		setIcon(matchWordButton, 'whole-word');
		if (entry.matchWord !== false) {
			matchWordButton.addClass('active');
		}
		optionsTd.addClass('supernote-settings-custom-dictionary-entry-options');
	const moveUpButton = optionsTd.createEl('button');
		moveUpButton.ariaLabel = 'Move entry up';
		moveUpButton.addClass('move-up');
		setIcon(moveUpButton, 'move-up');
	const moveDownButton = optionsTd.createEl('button');
		moveDownButton.ariaLabel = 'Move entry down';
		moveDownButton.addClass('move-down');
		setIcon(moveDownButton, 'move-down');
	const deleteButton = optionsTd.createEl('button');
		deleteButton.ariaLabel = 'Delete dictionary entry';
		setIcon(deleteButton, 'trash-2');

	// Update dictionary entry when input changes
	const updateDictionaryEntry = async () => {
		const index = Array.from(tbody.children).indexOf(tr)
		plugin.settings.customDictionary[index] = {
			source: sourceInput.value,
			replace: replaceInput.value,
			matchWord: matchWordButton.hasClass('active'),
			matchCase: matchCaseButton.hasClass('active'),
		};
		await plugin.saveSettings();
	}
	sourceInput.addEventListener('input', updateDictionaryEntry);
	replaceInput.addEventListener('input', updateDictionaryEntry);

	// Toggle match case when match case button is clicked
	matchCaseButton.addEventListener('click', async () => {
		matchCaseButton.toggleClass('active', !matchCaseButton.hasClass('active'));
		await updateDictionaryEntry();
	});

	// Toggle match word when match word button is clicked
	matchWordButton.addEventListener('click', async () => {
		matchWordButton.toggleClass('active', !matchWordButton.hasClass('active'));
		await updateDictionaryEntry();
	});

	// Move dictionary entry up when move up button is clicked
	moveUpButton.addEventListener('click', async () => {
		const index = Array.from(tbody.children).indexOf(tr);
		if (index === 0) return;
		[plugin.settings.customDictionary[index - 1], plugin.settings.customDictionary[index]] = [plugin.settings.customDictionary[index], plugin.settings.customDictionary[index - 1]];
		await plugin.saveSettings();
		tbody.insertBefore(tr, tr.previousElementSibling);
	});

	// Move dictionary entry down when move down button is clicked
	moveDownButton.addEventListener('click', async () => {
		const index = Array.from(tbody.children).indexOf(tr);
		const nextTr = tr.nextElementSibling;
		if (index === tbody.children.length - 1 || !nextTr) return;
		[plugin.settings.customDictionary[index], plugin.settings.customDictionary[index + 1]] = [plugin.settings.customDictionary[index + 1], plugin.settings.customDictionary[index]];
		await plugin.saveSettings();
		tbody.insertBefore(nextTr, tr);
	});

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

// Create the UI for the dictionary table
function createDictionaryTableUI(containerEl: HTMLElement, plugin: SupernotePlugin) {
	const CONTAINER_CLASSNAME = 'supernote-settings-custom-dictionary-entries';

	// Remove existing dictionary entries to prepare for re-render
	containerEl.find(`.${CONTAINER_CLASSNAME}`)?.remove();

	// Create the dictionary entries container
	const dictionaryEntriesContainer = containerEl.createDiv();
	dictionaryEntriesContainer
		.addClasses(['setting-item', CONTAINER_CLASSNAME]);
	dictionaryEntriesContainer.createDiv({ text: 'Custom Dictionary' })
		.addClass('setting-item-name');
	dictionaryEntriesContainer.createDiv({ text: 'Add an entry for every text string you would like to replace from Supernote\'s recognized text. The plugin will match and replace text based on the order in the table, starting from the top and moving to the bottom. So, if you want a more specific text to be replaced first, make sure to add it at the top. This way, the plugin can fall back to less strict matching if needed. Note, all case-sensitive matches will run as a group before case-insensitive matches.' })
		.addClasses(['setting-item-description']);

	// Create the dictionary entries table
	const table = dictionaryEntriesContainer.createEl('table');
	const thead = table.createEl('thead');
	const trHead = thead.createEl('tr');
	const tbody = table.createEl('tbody');

	trHead.createEl('th', { text: 'Source Text' });
	trHead.createEl('th', { text: 'Replacement' });
	trHead.createEl('th', { text: 'Options' });

	const addEmptyRow = () => {
		createDictionaryEntryUI({
			entry: {source: '', replace: ''},
			tbody,
			plugin
		});
	}

	// Create UI for existing dictionary entries
	for (const entry of plugin.settings.customDictionary) {
		createDictionaryEntryUI({
			entry,
			tbody,
			plugin
		});
	}

	// Add an empty row if there are no dictionary entries
	if (plugin.settings.customDictionary.length === 0) {
		addEmptyRow();
	}

	// Create the "Add dictionary entry" button
	const addEntryButton = dictionaryEntriesContainer.createEl('button', { text: 'Add dictionary entry' });
	addEntryButton.addEventListener('click', addEmptyRow);
}

// Create the UI for the custom dictionary settings
export function createCustomDictionarySettingsUI(containerEl: HTMLElement, plugin: SupernotePlugin): void {
	const customDictionaryContainer = containerEl.createDiv();
	customDictionaryContainer
		.addClasses(['supernote-settings-custom-dictionary']);
	customDictionaryContainer.createEl('h3', { text: 'Custom Dictionary' })
		// .addClass('setting-item-name');
	customDictionaryContainer.createDiv({ text: 'You can add custom entries to your dictionary to fix errors from Supernote\'s handwriting recognition. This also lets you automatically swap out certain text with your preferred wording, add special markdown characters, etc.' })
		.addClasses(['setting-item-description', 'supernote-settings-custom-dictionary-subtitle']);
		
	// Create the "Enable Custom Dictionary" setting
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

	// Create the dictionary entries setting
	createDictionaryTableUI(customDictionaryContainer, plugin);
}

// Escape special characters in a string to be used in a regular expression
function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replace text with custom dictionary entries
export function replaceTextWithCustomDictionary(text: string, customDictionary: CustomDictionarySettings['customDictionary']): string {
	let newText = text;

	const [caseInsensitiveMatchers, caseSensitiveMatchers] = customDictionary.reduce((acc, entry) => {
		const source = entry.source;
		const matcher = entry.matchWord ? `\\b${escapeRegExp(source)}\\b` : escapeRegExp(source);
		if (entry.matchCase) {
			acc[1].push(matcher);
		} else {
			acc[0].push(matcher);
		}
		return acc;
	}, [[], []] as [string[], string[]]);


	newText = newText.replace(new RegExp(caseSensitiveMatchers.join('|'), 'g'), (match) => {
		const entry = customDictionary.find(entry => entry.source === match);
		return entry ? entry.replace : match;
	});

	newText = newText.replace(new RegExp(caseInsensitiveMatchers.join('|'), 'gi'), (match) => {
		const entry = customDictionary.find(entry => entry.source.toLocaleUpperCase() === match.toLocaleUpperCase());
		return entry ? entry.replace : match;
	});

	return newText;
}
