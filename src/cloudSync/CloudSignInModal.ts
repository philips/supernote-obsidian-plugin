import { App, Modal, Notice } from 'obsidian';
import type { SupernotePluginSettings } from '../settings';
import { signInCloud } from './cloudSessionActions';

export class CloudSignInModal extends Modal {
    private cancelled = false;
    private submitting = false;
    private rejectCode: ((error: Error) => void) | null = null;

    constructor(app: App, private readonly settings: SupernotePluginSettings,
        private readonly onSignedIn: () => void, private readonly onClosed: () => void) {
        super(app);
    }

    onOpen(): void {
        this.cancelled = false;
        this.contentEl.empty();
        this.modalEl.addClass('supernote-cloud-sign-in-modal');
        this.contentEl.createEl('h2', { text: 'Sign in to Supernote cloud' });
        const form = this.contentEl.createEl('form', { cls: 'supernote-cloud-sign-in-form' });
        form.noValidate = true;
        const emailLabel = form.createEl('label', { text: 'Email' });
        const email = emailLabel.createEl('input', { type: 'email', attr: { autocomplete: 'username' } });
        const passwordLabel = form.createEl('label', { text: 'Password' });
        const password = passwordLabel.createEl('input', { type: 'password', attr: { autocomplete: 'current-password' } });
        const actions = form.createDiv({ cls: 'supernote-cloud-sign-in-actions' });
        const submit = actions.createEl('button', { text: 'Sign in', cls: 'mod-cta', attr: { type: 'submit' } });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (this.submitting || !email.value.trim() || !password.value) return;
            this.submitting = true;
            submit.disabled = true;
            const credentials = { email: email.value.trim(), password: password.value };
            password.value = '';
            void signInCloud(this.app, this.settings, credentials, () => this.requestCode(), () => this.cancelled)
                .then(() => {
                    if (!this.cancelled) {
                        new Notice('Supernote Cloud signed in');
                        this.close();
                        this.onSignedIn();
                    }
                })
                .catch((error: unknown) => {
                    if (this.cancelled) return;
                    const message = error instanceof Error ? error.message : '';
                    const accountMismatch = message.includes('another account') || message.includes('binding does not match');
                    new Notice(accountMismatch
                        ? 'Cloud sign-in blocked: this mirror is bound to another account'
                        : 'Cloud sign-in failed. Check your credentials, verification code, and connection.');
                    this.onOpen();
                })
                .finally(() => { this.submitting = false; submit.disabled = false; });
        });
        email.focus();
    }

    private requestCode(): Promise<string> {
        if (this.cancelled) return Promise.reject(new Error('Sign-in cancelled'));
        return new Promise((resolve, reject) => {
            this.rejectCode = reject;
            this.contentEl.empty();
            this.contentEl.createEl('h2', { text: 'Email verification' });
            this.contentEl.createEl('p', { text: 'Enter the code sent to your email.' });
            const form = this.contentEl.createEl('form', { cls: 'supernote-cloud-sign-in-form' });
            form.noValidate = true;
            const label = form.createEl('label', { text: 'Verification code' });
            const input = label.createEl('input', { type: 'text', attr: { autocomplete: 'one-time-code' } });
            const actions = form.createDiv({ cls: 'supernote-cloud-sign-in-actions' });
            const button = actions.createEl('button', { text: 'Verify', cls: 'mod-cta', attr: { type: 'submit' } });
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                if (!input.value.trim()) return;
                const code = input.value;
                input.value = '';
                button.disabled = true;
                this.rejectCode = null;
                resolve(code);
            });
            input.focus();
        });
    }

    onClose(): void {
        this.cancelled = true;
        this.rejectCode?.(new Error('Sign-in cancelled'));
        this.rejectCode = null;
        this.contentEl.querySelectorAll('input').forEach((input) => { input.value = ''; });
        this.contentEl.empty();
        this.onClosed();
    }
}