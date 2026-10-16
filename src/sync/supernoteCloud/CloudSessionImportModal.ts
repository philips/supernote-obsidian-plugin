import { App, Modal, Notice } from 'obsidian';
import { importCloudSession } from './importCloudSession';

export function cloudImportFailureNotice(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message === 'Cloud session cache is invalid' || message === 'A Cloud access token is required') {
        return 'Cloud import failed: paste an access token or valid session JSON';
    }
    if (message === 'Cloud session belongs to another account' || message.includes('account identity does not match')) {
        return 'Cloud import failed: account does not match the saved binding';
    }
    if (message === 'This Obsidian runtime does not support SecretStorage'
        || message === 'SecretStorage did not retain the validated session') {
        return 'Cloud import failed: SecretStorage is unavailable or did not retain the session';
    }
    if (message === 'Supernote Cloud request failed' || message === 'Supernote Cloud request timed out') {
        return `Cloud import failed: ${message}; session not stored`;
    }
    if (/^Supernote Cloud request failed \((?:account identity|CSRF or other request): fetch rejected \((?:TypeError|other)\)\)$/.test(message)) {
        return `Cloud import failed: ${message}; session not stored`;
    }
    if (/^Supernote Cloud request failed \(HTTP \d{3}\)$/.test(message)) {
        return `Cloud import failed: ${message}; session not stored`;
    }
    return 'Cloud import failed during account verification; session not stored';
}

export class CloudSessionImportModal extends Modal {
    private tokenInput!: HTMLInputElement;
    private submitButton!: HTMLButtonElement;
    private submitting = false;

    constructor(app: App) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.createEl('h2', { text: 'Import cloud access token' });
        this.contentEl.createEl('p', {
            text: 'Paste an access token or the cached session JSON. The account will be verified before storage.',
        });
        this.tokenInput = this.contentEl.createEl('input', {
            type: 'password',
            attr: { autocomplete: 'off', spellcheck: 'false' },
        });
        this.tokenInput.addClass('full-width');
        this.tokenInput.setAttribute('aria-label', 'Cloud access token');
        this.tokenInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.submit();
            }
        });
        this.submitButton = this.contentEl.createEl('button', {
            text: 'Validate and store',
            cls: 'mod-cta',
        });
        this.submitButton.addEventListener('click', () => { void this.submit(); });
        this.tokenInput.focus();
    }

    onClose(): void {
        if (this.tokenInput) this.tokenInput.value = '';
        this.contentEl.empty();
    }

    private async submit(): Promise<void> {
        if (this.submitting) return;
        this.submitting = true;
        const token = this.tokenInput.value;
        this.tokenInput.value = '';
        this.tokenInput.disabled = true;
        this.submitButton.disabled = true;
        try {
            await importCloudSession(this.app, token);
            new Notice('Cloud access token validated and stored securely');
            this.close();
        } catch (error) {
            this.submitting = false;
            this.tokenInput.disabled = false;
            this.submitButton.disabled = false;
            new Notice(cloudImportFailureNotice(error));
        }
    }
}