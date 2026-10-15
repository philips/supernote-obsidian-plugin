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
        this.contentEl.createEl('h2', { text: 'Sign in to Supernote Cloud' });
        const email = this.contentEl.createEl('input', { type: 'email', attr: { autocomplete: 'username' } });
        email.setAttribute('aria-label', 'Cloud email');
        email.addClass('full-width');
        const password = this.contentEl.createEl('input', { type: 'password', attr: { autocomplete: 'current-password' } });
        password.setAttribute('aria-label', 'Cloud password');
        password.addClass('full-width');
        const submit = this.contentEl.createEl('button', { text: 'Sign in', cls: 'mod-cta' });
        submit.addEventListener('click', () => {
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
            const input = this.contentEl.createEl('input', { type: 'text', attr: { autocomplete: 'one-time-code' } });
            input.setAttribute('aria-label', 'Email verification code');
            input.addClass('full-width');
            const button = this.contentEl.createEl('button', { text: 'Verify', cls: 'mod-cta' });
            button.addEventListener('click', () => {
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