import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import { VaultFolderPickerModal } from './VaultFolderPickerModal';

beforeAll(async () => {
    const { Window } = await vi.importActual<{ Window: new () => {
        document: Document; HTMLElement: typeof HTMLElement; Event: typeof Event; KeyboardEvent: typeof KeyboardEvent;
    } }>('happy-dom');
    const dom = new Window();
    vi.stubGlobal('document', dom.document);
    vi.stubGlobal('HTMLElement', dom.HTMLElement);
    vi.stubGlobal('Event', dom.Event);
    vi.stubGlobal('KeyboardEvent', dom.KeyboardEvent);
    Object.assign(dom.HTMLElement.prototype, {
    empty(this: HTMLElement) { this.replaceChildren(); },
    setText(this: HTMLElement, text: string) { this.textContent = text; },
    addClass(this: HTMLElement, name: string) { this.classList.add(name); },
    createEl(this: HTMLElement, tag: string, options?: { text?: string; cls?: string; attr?: Record<string, string> }) {
        const child = document.createElement(tag);
        if (options?.text) child.textContent = options.text;
        if (options?.cls) child.className = options.cls;
        for (const [name, value] of Object.entries(options?.attr ?? {})) child.setAttribute(name, value);
        this.append(child);
        return child;
    },
    createDiv(this: HTMLElement, options?: { cls?: string }) {
        const child = document.createElement('div');
        if (options?.cls) child.className = options.cls;
        this.append(child);
        return child;
    },
    createSpan(this: HTMLElement, options?: { cls?: string }) {
        const child = document.createElement('span');
        if (options?.cls) child.className = options.cls;
        this.append(child);
        return child;
    },
    });
});

vi.mock('obsidian', () => {
    class Folder {
        children: Folder[] = [];
        parent: Folder | null = null;
        path = '';
        name = '/';
    }
    return {
        App: class App {}, TFolder: Folder, TFile: class File {}, setIcon: () => {},
        Modal: class Modal {
            contentEl = document.createElement('div');
            constructor(public app: App) { document.body.append(this.contentEl); }
            setTitle() {}
            open() { (this as unknown as { onOpen(): void }).onOpen(); }
            close() { (this as unknown as { onClose(): void }).onClose(); this.contentEl.remove(); }
        },
        Setting: class Setting {
            constructor(private container: HTMLElement) {}
            setName() { return this; }
            addText(configure: (text: unknown) => void) {
                const input = document.createElement('input');
                this.container.append(input);
                const component = { setPlaceholder: (value: string) => { input.placeholder = value; return component; },
                    onChange: (callback: (value: string) => void) => {
                        input.addEventListener('input', () => callback(input.value)); return component;
                    } };
                configure(component);
                return this;
            }
            addButton(configure: (button: unknown) => void) {
                const element = document.createElement('button');
                this.container.append(element);
                const component = { setButtonText: (value: string) => { element.textContent = value; return component; },
                    setCta: () => component,
                    setDisabled: (value: boolean) => { element.disabled = value; return component; },
                    onClick: (callback: () => void) => { element.addEventListener('click', callback); return component; } };
                configure(component);
                return this;
            }
        },
    };
});

function fixture() {
    const root = Object.assign(new TFolder(), { path: '', name: '/' });
    const notes = Object.assign(new TFolder(), { path: 'Notes', name: 'Notes' });
    const journal = Object.assign(new TFolder(), { path: 'Notes/Journal', name: 'Journal' });
    const archive = Object.assign(new TFolder(), { path: 'Archive', name: 'Archive' });
    root.children = [notes, archive];
    notes.parent = root;
    notes.children = [journal];
    journal.parent = notes;
    archive.parent = root;
    const folders = [root, notes, journal, archive];
    root.children.push(new TFile());
    const app = { vault: {
        getRoot: () => root,
        getAllFolders: () => folders,
        getFolderByPath: (path: string) => folders.find((folder) => folder.path === path) ?? null,
    } } as unknown as App;
    return { app, root, notes, journal, folders };
}

const row = (path: string) => [...document.querySelectorAll<HTMLButtonElement>('.supernote-folder-picker-row')]
    .find((button) => button.textContent === path);
const action = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === label);

afterEach(() => { document.body.replaceChildren(); });

it('expands ancestors, highlights the existing selection, and keeps cancellation inert', () => {
    const { app } = fixture();
    const select = vi.fn();
    new VaultFolderPickerModal(app, 'Notes/Journal', false, select).open();
    expect(row('Notes/Journal')?.getAttribute('aria-pressed')).toBe('true');
    expect(row('/')?.disabled).toBe(true);
    action('Cancel')?.click();
    expect(select).not.toHaveBeenCalled();
});

it('allows selecting a parent or vault root and supports collapsible, searchable folders', () => {
    const { app, root, notes } = fixture();
    const select = vi.fn();
    new VaultFolderPickerModal(app, null, true, select).open();
    expect(row('Notes/Journal')).toBeUndefined();
    expect(document.querySelectorAll('.supernote-folder-picker-row')).toHaveLength(3);
    row('Notes')?.click();
    expect(row('Notes')?.getAttribute('aria-pressed')).toBe('true');
    expect(row('Notes/Journal')).toBeUndefined();
    const search = document.querySelector<HTMLInputElement>('input');
    if (!search) throw new Error('Search input missing');
    search.value = 'journal';
    search.dispatchEvent(new Event('input'));
    expect(row('Notes/Journal')).toBeDefined();
    expect(row('Archive')).toBeUndefined();
    row('Notes')?.focus();
    row('Notes')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(row('Notes/Journal')).toBeUndefined();
    expect(document.activeElement).toBe(row('Notes'));
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(row('Notes/Journal')).toBeUndefined();
    action('Select')?.click();
    expect(select).toHaveBeenCalledWith(notes);

    new VaultFolderPickerModal(app, '', true, select).open();
    expect(row('/')?.getAttribute('aria-pressed')).toBe('true');
    action('Select')?.click();
    expect(select).toHaveBeenLastCalledWith(root);
});

it('prevents confirmation when the selected folder has been removed', () => {
    const { app, folders } = fixture();
    const select = vi.fn();
    new VaultFolderPickerModal(app, 'Archive', false, select).open();
    folders.pop();
    action('Select')?.click();
    expect(select).not.toHaveBeenCalled();
    expect(action('Select')?.disabled).toBe(true);
    expect(document.querySelector('.supernote-sync-folder-warning')?.textContent).toMatch(/no longer exists/);
});

it('opens the vault root branch even when its path is not empty', () => {
    const { app, root } = fixture();
    root.path = '/';
    new VaultFolderPickerModal(app, null, false, vi.fn()).open();
    expect(row('Notes')).toBeDefined();
    expect(document.querySelector('.supernote-folder-picker-toggle')?.getAttribute('aria-expanded')).toBe('true');
});