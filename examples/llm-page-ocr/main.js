'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, requestUrl } = require('obsidian');

const SUPERNOTE_PLUGIN_ID = 'supernote';
const LOG_PREFIX = 'LLM Page OCR';

const DEFAULT_SETTINGS = {
	// Matches Jan.ai's default local-server port, but any OpenAI-compatible
	// server works here (Jan.ai, LM Studio, Ollama, llama.cpp server, vLLM...).
	apiBase: 'http://127.0.0.1:1337/v1',
	// Must be a vision-capable model (e.g. a LLaVA/Moondream/Qwen-VL build) —
	// most default text-only models will ignore the image.
	model: '',
	systemPrompt:
		'You transcribe handwritten notes from a single page image into clean Markdown. ' +
		'Reflow the handwriting into normal paragraphs: join wrapped or hand-broken lines ' +
		'that belong to the same sentence or thought, and only start a new paragraph where ' +
		'the writer clearly intended a break (blank line, indent, new topic) — do not keep ' +
		'a line break just because the original line ended there. Use Markdown structure ' +
		'(headings, bullet/numbered lists, bold/italic) only where the page itself clearly ' +
		'signals it (underlines, indentation, dashes/numbers, larger writing); don\'t invent ' +
		'structure that isn\'t on the page. Return only the transcription itself — no ' +
		'commentary, preamble, or code fences. If the page is blank or illegible, return an ' +
		'empty string.',
	// When true, only pages with no recognized text yet are sent for OCR;
	// pages the device already transcribed (RECOGNTEXT) are left alone.
	onlyFillMissing: true,
	maxTokens: 1024,
	timeoutMs: 60000,
};

// Supernote page renders have a transparent background (the vault's own
// attachment relies on that — see the "invert colors in dark mode" CSS trick
// in the main plugin's styles.css). Left as-is, a lot of vision models/
// backends composite transparency onto black rather than white before
// looking at it, which can turn an otherwise-legible page into something the
// model reports as blank or unreadable. Flattening onto white here only
// affects the copy sent over the wire — the vault's PNG is untouched.
async function flattenToWhiteBackground(imageBytes, mimeType) {
	const blob = new Blob([imageBytes], { type: mimeType });
	const bitmap = await createImageBitmap(blob);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(bitmap, 0, 0);
		return canvas.toDataURL('image/png');
	} finally {
		bitmap.close();
	}
}

module.exports = class LlmPageOcrPlugin extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.addSettingTab(new LlmPageOcrSettingTab(this.app, this));
		this.unregisterProcessor = null;
		this.registerRetryTimer = null;
		this.progressNotice = null;

		this.registerWithSupernote();
	}

	// The Supernote plugin may not have finished loading yet, or may not even
	// be enabled yet — both plugins load independently, in whatever order
	// Obsidian (or the user, toggling them on individually) happens to get to
	// them. `workspace.onLayoutReady()` only fires once, the first time
	// layout finishes restoring after app startup, so it doesn't help here:
	// enabling/reloading this plugin later (the common case when installing
	// two new plugins) means that event already fired, and a single check
	// right then can permanently miss a Supernote that hasn't loaded yet.
	// Retrying for a while instead of checking once turns "wrong enable
	// order" from a silent, permanent miss into "works a moment later."
	registerWithSupernote(attempt = 0) {
		const supernote = this.app.plugins.plugins[SUPERNOTE_PLUGIN_ID];
		if (supernote && typeof supernote.registerPageTextProcessor === 'function') {
			this.unregisterProcessor = supernote.registerPageTextProcessor((ctx) => this.processPage(ctx));
			return;
		}

		const maxAttempts = 20; // ~10s at 500ms apart
		if (attempt < maxAttempts) {
			this.registerRetryTimer = window.setTimeout(() => this.registerWithSupernote(attempt + 1), 500);
			return;
		}

		new Notice(
			`${LOG_PREFIX}: could not find the Supernote plugin (enabled, with ` +
			'registerPageTextProcessor) after 10s. Enable/update it, then reload this plugin.',
		);
	}

	// Pages are processed one at a time, in order, by the Supernote plugin's
	// own loop (see writeMarkdownFile/buildInsertableContent in src/main.ts)
	// — so pageNumber reliably starts at 1 and counts up for a given run,
	// with no concurrent processPage() calls to interleave. That's what lets
	// a single sticky Notice, opened on page 1 and closed once pageNumber
	// reaches totalPages, track the whole run as one visible progress
	// indicator instead of one popup per page.
	async processPage(ctx) {
		if (ctx.pageNumber === 1) this.startProgress(ctx.totalPages);

		try {
			if (this.settings.onlyFillMissing && ctx.text && ctx.text.trim().length > 0) {
				console.debug(`${LOG_PREFIX}: skipping page ${ctx.pageNumber} — already has recognized text (Only fill missing text is on)`);
				this.updateProgress(ctx.pageNumber, ctx.totalPages, 'already has text, skipped');
				return null; // leave the device's own recognized text alone
			}
			if (!this.settings.model) {
				// Fails every page, silently by design (no Notice spam per
				// page), but this is exactly the kind of "nothing happened
				// and I can't tell why" gap the requestUrl-doesn't-show-in-
				// Network-tab confusion feeds into — always log it so the
				// console tells the real story.
				console.warn(`${LOG_PREFIX}: no Model configured in settings — skipping page`, ctx.pageNumber);
				this.updateProgress(ctx.pageNumber, ctx.totalPages, 'no model set, skipped');
				return null;
			}

			this.updateProgress(ctx.pageNumber, ctx.totalPages, 'contacting server…');
			console.debug(`${LOG_PREFIX}: requesting page ${ctx.pageNumber}/${ctx.totalPages} from ${this.settings.apiBase} (model: ${this.settings.model})`);

			try {
				const imageBytes = await ctx.readImage();
				const dataUrl = await flattenToWhiteBackground(imageBytes, ctx.imageMimeType);

				const response = await requestUrl({
					url: `${this.settings.apiBase.replace(/\/$/, '')}/chat/completions`,
					method: 'POST',
					contentType: 'application/json',
					body: JSON.stringify({
						model: this.settings.model,
						max_tokens: this.settings.maxTokens,
						messages: [
							{ role: 'system', content: this.settings.systemPrompt },
							{
								role: 'user',
								content: [
									{ type: 'text', text: `Transcribe page ${ctx.pageNumber} of ${ctx.totalPages} from "${ctx.sourceName}".` },
									{ type: 'image_url', image_url: { url: dataUrl } },
								],
							},
						],
					}),
					throw: false,
				});

				if (response.status < 200 || response.status >= 300) {
					console.error(`${LOG_PREFIX}: request failed`, response.status, response.text);
					this.updateProgress(ctx.pageNumber, ctx.totalPages, `failed (HTTP ${response.status})`);
					return null;
				}

				const text = response.json?.choices?.[0]?.message?.content;
				console.debug(`${LOG_PREFIX}: page ${ctx.pageNumber} -> ${response.status}, ${typeof text === 'string' ? text.length : 0} chars`);
				this.updateProgress(ctx.pageNumber, ctx.totalPages, 'transcribed');
				return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
			} catch (err) {
				console.error(`${LOG_PREFIX}: processor failed`, err);
				this.updateProgress(ctx.pageNumber, ctx.totalPages, 'error, see console');
				return null;
			}
		} finally {
			if (ctx.pageNumber >= ctx.totalPages) this.finishProgress();
		}
	}

	startProgress(totalPages) {
		// A run that never reached its last page (export aborted elsewhere)
		// would otherwise leave a stale notice behind for the next one to
		// inherit — clear it defensively before opening a fresh one.
		this.progressNotice?.hide();
		this.progressNotice = new Notice(`${LOG_PREFIX}: page 1/${totalPages}…`, 0); // 0 = sticky, no auto-dismiss
	}

	updateProgress(pageNumber, totalPages, status) {
		this.progressNotice?.setMessage(`${LOG_PREFIX}: page ${pageNumber}/${totalPages} — ${status}`);
	}

	finishProgress() {
		const notice = this.progressNotice;
		this.progressNotice = null;
		if (!notice) return;
		notice.setMessage(`${LOG_PREFIX}: done`);
		window.setTimeout(() => notice.hide(), 1500);
	}

	onunload() {
		window.clearTimeout(this.registerRetryTimer);
		this.progressNotice?.hide();
		this.unregisterProcessor?.();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Checks both halves of the pipeline in one shot — whether this plugin
	// actually hooked into the Supernote plugin, and whether the configured
	// server is reachable with the configured model — so "is this working"
	// doesn't require opening the console and running an export to find out.
	async testConnection() {
		if (!this.app.plugins.plugins[SUPERNOTE_PLUGIN_ID]) {
			new Notice(`${LOG_PREFIX}: the Supernote plugin isn't enabled — nothing to hook into.`);
			return;
		}
		if (!this.unregisterProcessor) {
			new Notice(`${LOG_PREFIX}: not registered with the Supernote plugin yet (still retrying since load, or gave up — check the console).`);
			return;
		}

		const base = this.settings.apiBase.replace(/\/$/, '');
		let response;
		try {
			response = await requestUrl({ url: `${base}/models`, method: 'GET', throw: false });
		} catch (err) {
			console.error(`${LOG_PREFIX}: test connection error`, err);
			new Notice(`${LOG_PREFIX}: could not reach ${base} — ${err instanceof Error ? err.message : String(err)}. Is your local server running?`);
			return;
		}

		if (response.status < 200 || response.status >= 300) {
			console.error(`${LOG_PREFIX}: test connection failed`, response.status, response.text);
			new Notice(`${LOG_PREFIX}: ${base} responded ${response.status} — check the API base URL.`);
			return;
		}

		const models = (response.json?.data ?? []).map((m) => m.id).filter(Boolean);
		console.debug(`${LOG_PREFIX}: test connection — loaded models`, models);

		if (models.length === 0) {
			new Notice(`${LOG_PREFIX}: connected to the server, but it has no models loaded.`);
			return;
		}
		if (!this.settings.model) {
			new Notice(`${LOG_PREFIX}: connected. Registered ✓. ${models.length} model(s) loaded, but no Model is set in settings — nothing will be sent for OCR. Loaded: ${models.join(', ')}`);
			return;
		}
		if (!models.includes(this.settings.model)) {
			new Notice(`${LOG_PREFIX}: connected. Registered ✓. Configured model "${this.settings.model}" is NOT currently loaded. Loaded: ${models.join(', ')}`);
			return;
		}

		new Notice(`${LOG_PREFIX}: all good ✓ Registered with Supernote, connected to the server, "${this.settings.model}" is loaded.`);
	}
};

class LlmPageOcrSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('p', {
			text:
				'Sends each Supernote page image to any local OpenAI-compatible server ' +
				'(Jan.ai, LM Studio, Ollama, llama.cpp server, etc.) for transcription, via ' +
				'the Supernote plugin\'s registerPageTextProcessor hook. Requires the ' +
				'Supernote plugin enabled.',
		});

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Checks it\'s registered with the Supernote plugin and that the server is reachable with the configured model — no need to run a real export or open the console.')
			.addButton((button) =>
				button
					.setButtonText('Test connection')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true).setButtonText('Testing…');
						try {
							await this.plugin.testConnection();
						} finally {
							button.setDisabled(false).setButtonText('Test connection');
						}
					}),
			);

		new Setting(containerEl)
			.setName('API base URL')
			.setDesc('The OpenAI-compatible base URL of your local server. Default matches Jan.ai\'s own default port — change it for LM Studio, Ollama, etc.')
			.addText((text) =>
				text
					.setPlaceholder('http://127.0.0.1:1337/v1')
					.setValue(this.plugin.settings.apiBase)
					.onChange(async (value) => {
						this.plugin.settings.apiBase = value.trim() || DEFAULT_SETTINGS.apiBase;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Must be a vision-capable model loaded on your server (e.g. a LLaVA/Moondream/Qwen-VL build) — text-only models will ignore the image.')
			.addText((text) =>
				text
					.setPlaceholder('e.g. llava-1.6-mistral-7b')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Only fill missing text')
			.setDesc('When on, only OCR pages the device didn\'t already recognize. When off, re-transcribe every page, overwriting the device\'s own text.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.onlyFillMissing).onChange(async (value) => {
					this.plugin.settings.onlyFillMissing = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('System prompt')
			.setDesc('Sent as the system message alongside each page image.')
			.addTextArea((text) => {
				text.inputEl.rows = 8;
				text.inputEl.cols = 50;
				return text
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Max tokens')
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxTokens)).onChange(async (value) => {
					const n = Number(value);
					if (Number.isFinite(n) && n > 0) {
						this.plugin.settings.maxTokens = n;
						await this.plugin.saveSettings();
					}
				}),
			);
	}
}
