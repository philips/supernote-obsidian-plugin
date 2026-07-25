import { App, Modal } from 'obsidian';

// Shared error display for the plugin's commands and device-connection
// flows, so a failure always surfaces the same persistent, visible dialog
// instead of a mix of modals and easy-to-miss Notices.
export class ErrorModal extends Modal {
    error: Error;

    constructor(app: App, error: Error) {
        super(app);
        this.error = error;
    }

    onOpen() {
        const { contentEl } = this;
        const message = this.error.message;
        contentEl.setText(`Error: ${message}${message.endsWith('.') ? '' : '.'}`);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
