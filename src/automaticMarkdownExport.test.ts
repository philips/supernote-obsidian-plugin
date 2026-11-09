import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { AutomaticMarkdownExport } from './automaticMarkdownExport';
import type { AutomaticMarkdownResult } from './automaticMarkdownExport';
import { DEFAULT_SETTINGS } from './settings';
import type { NoteConversion, SupernotePluginSettings } from './settings';
import { ObsidianCloudMirrorVault } from './sync/supernoteCloud/obsidianCloudMirrorVault';

vi.mock('obsidian', () => ({
    Modal: class {},
    PluginSettingTab: class {},
    Setting: class {},
    TFile: class TFile {
        extension = 'note';
        path = '';
    },
    TFolder: class TFolder {},
}));

class FakeFile extends TFile {
    constructor(path: string) {
        super();
        this.path = path;
        this.extension = path.split('.').pop() ?? '';
    }
}

describe('automatic Markdown export', () => {
    let files: Map<string, { file: FakeFile; content: string }>;
    let settings: SupernotePluginSettings;
    let save: ReturnType<typeof vi.fn<() => Promise<void>>>;
    let convert: ReturnType<typeof vi.fn<(file: FakeFile, destination: string, bytes: ArrayBuffer, format: NoteConversion) => Promise<string | AutomaticMarkdownResult>>>;
    let report: ReturnType<typeof vi.fn<(source: string, destination: string, reason: string) => void>>;
    let app: never;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.stubGlobal('window', globalThis);
        files = new Map();
        settings = { ...DEFAULT_SETTINGS, automaticMarkdownExportEnabled: true,
            markdownExportMappings: [{ id: 'one', enabled: true, watchDir: 'Notes', outputDir: 'Exports' }],
            markdownExportRecords: {}, markdownExportPendingMove: null, markdownExportBlockedSources: {} };
        save = vi.fn<() => Promise<void>>(async () => {});
        convert = vi.fn<(file: FakeFile, destination: string, bytes: ArrayBuffer, format: NoteConversion) => Promise<string | AutomaticMarkdownResult>>(async (file, destination) => `${file.path} -> ${destination}`);
        report = vi.fn<(source: string, destination: string, reason: string) => void>();
        const vault = {
            getFiles: () => [...files.values()].map(({ file }) => file),
            getFileByPath: (path: string) => files.get(path)?.file ?? null,
            getAbstractFileByPath: (path: string) => files.get(path)?.file ?? null,
            read: async (file: FakeFile) => files.get(file.path)!.content,
            readBinary: async (file: FakeFile) => new TextEncoder().encode(files.get(file.path)!.content).buffer,
            createFolder: async () => {},
            create: async (path: string, content: string) => {
                if (files.has(path)) throw new Error('occupied');
                const file = new FakeFile(path);
                files.set(path, { file, content });
                return file;
            },
            createBinary: async (path: string, content: ArrayBuffer) => {
                if (files.has(path)) throw new Error('occupied');
                const file = new FakeFile(path);
                files.set(path, { file, content: new TextDecoder().decode(content) });
                return file;
            },
            modifyBinary: async (file: FakeFile, content: ArrayBuffer) => {
                files.get(file.path)!.content = new TextDecoder().decode(content);
            },
            modify: async (file: FakeFile, content: string) => { files.get(file.path)!.content = content; },
            process: async (file: FakeFile, update: (content: string) => string) => {
                const entry = files.get(file.path)!;
                entry.content = update(entry.content);
                return entry.content;
            },
            rename: async (file: FakeFile, path: string) => {
                if (files.has(path)) throw new Error('occupied');
                const entry = files.get(file.path)!;
                files.delete(file.path);
                file.path = path;
                files.set(path, entry);
            },
        };
        app = { vault } as never;
    });

    async function flush() {
        await vi.runAllTimersAsync();
    }

    it('hands a FileManager source rename to the Markdown-only export listener', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        const bridge = app as { vault: { rename(file: FakeFile, path: string): Promise<void> },
            fileManager?: { renameFile(file: FakeFile, path: string): Promise<void> } };
        const renameFile = vi.fn(async (file: FakeFile, destination: string) => {
            const oldPath = file.path;
            await bridge.vault.rename(file, destination);
            exporter.rename(file, oldPath);
        });
        bridge.fileManager = { renameFile };

        await new ObsidianCloudMirrorVault(app).rename('Notes/day.note', 'Notes/new.note');
        await flush();

        expect(renameFile).toHaveBeenCalledExactlyOnceWith(source, 'Notes/new.note');
        expect(files.has('Exports/day.md')).toBe(false);
        expect(files.has('Exports/new.md')).toBe(true);
        expect(settings.markdownExportRecords['Exports/new.md']?.source).toBe('Notes/new.note');
        expect(report).not.toHaveBeenCalled();
    });

    it.each(['png', 'svg'] as const)('creates and refreshes managed %s page attachments', async (format) => {
        settings.markdownExportMappings[0].noteConversion = format;
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        const imagePath = `Exports/day-pages/1.${format}`;
        convert.mockImplementation(async (_file, _destination, _bytes, selected) => {
            expect(selected).toBe(format);
            return { content: `![page](day-pages/1.${format})`, attachments: [
                { path: imagePath, content: new TextEncoder().encode(files.get(source.path)!.content).buffer },
            ] };
        });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        expect(files.get(imagePath)?.content).toBe('first');
        expect(files.get('Exports/day.md')?.content).toContain(`day-pages/1.${format}`);
        expect(settings.markdownExportRecords['Exports/day.md'].attachments?.[imagePath]).toBeTruthy();
        files.get(source.path)!.content = 'second';
        exporter.schedule(source);
        await flush();
        expect(files.get(imagePath)?.content).toBe('second');
        expect(report).not.toHaveBeenCalled();
        files.get(imagePath)!.content = 'local edit';
        files.get(source.path)!.content = 'third';
        exporter.schedule(source);
        await flush();
        expect(files.get(imagePath)?.content).toBe('local edit');
        expect(files.get('Exports/day.md')?.content).toContain(`day-pages/1.${format}`);
        expect(report).toHaveBeenCalledWith(source.path, 'Exports/day.md', expect.stringContaining('locally edited'));
    });

    it('does not move Markdown without its managed attachments on rename', async () => {
        settings.markdownExportMappings[0].noteConversion = 'png';
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        convert.mockResolvedValue({ content: '![page](day-pages/1.png)', attachments: [
            { path: 'Exports/day-pages/1.png', content: new TextEncoder().encode('image').buffer },
        ] });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: 'first' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.has('Exports/day.md')).toBe(true);
        expect(files.has('Exports/day-pages/1.png')).toBe(true);
        expect(files.has('Exports/new.md')).toBe(false);
        expect(report).toHaveBeenCalledWith(source.path, 'Exports/new.md', expect.stringContaining('needs review'));
    });

    it('creates at the deterministic path, updates only owned content and protects edits', async () => {
        const source = new FakeFile('Notes/Journal/day.note');
        files.set(source.path, { file: source, content: 'source' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        expect(files.get('Exports/Journal/day.md')?.content).toBe('Notes/Journal/day.note -> Exports/Journal/day.md');
        expect(settings.markdownExportRecords['Exports/Journal/day.md']?.source).toBe(source.path);
        files.get('Exports/Journal/day.md')!.content = 'local edit';
        exporter.schedule(source);
        await flush();
        expect(files.get('Exports/Journal/day.md')?.content).toBe('local edit');
        expect(report).toHaveBeenCalledOnce();
    });

    it('preserves a local edit made immediately before the atomic update', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        convert.mockResolvedValueOnce('new generated text');
        const vault = (app as { vault: { process: (file: FakeFile, update: (content: string) => string) => Promise<string> } }).vault;
        vault.process = vi.fn(async (file: FakeFile, update: (content: string) => string) => {
            files.get(file.path)!.content = 'local edit';
            files.get(file.path)!.content = update(files.get(file.path)!.content);
            return files.get(file.path)!.content;
        });
        exporter.schedule(source);
        await flush();
        expect(files.get('Exports/day.md')?.content).toBe('local edit');
        expect(report).toHaveBeenCalledOnce();
    });

    it('does not adopt an unmanaged destination or claim a failed create', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'mine' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        expect(files.get('Exports/day.md')?.content).toBe('mine');
        expect(settings.markdownExportRecords).toEqual({});
        files.delete('Exports/day.md');
        save.mockRejectedValueOnce(new Error('save failed'));
        exporter.schedule(source);
        await flush();
        expect(files.has('Exports/day.md')).toBe(true);
        expect(settings.markdownExportRecords).toEqual({});
        expect(report).toHaveBeenCalledTimes(2);
    });

    it('moves a verified export and refreshes path-dependent links after a rename', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.has('Exports/day.md')).toBe(false);
        expect(files.get('Exports/new.md')?.content).toBe('Notes/new.note -> Exports/new.md');
        expect(settings.markdownExportRecords['Exports/new.md']?.source).toBe(source.path);
        expect(settings.markdownExportPendingMove).toBeNull();
        expect(report).not.toHaveBeenCalled();
    });

    it('moves a managed Markdown-only export back to its original name', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        for (const destination of ['Notes/day1.note', 'Notes/day.note']) {
            const oldPath = source.path;
            files.delete(oldPath);
            source.path = destination;
            files.set(destination, { file: source, content: 'first' });
            exporter.rename(source, oldPath);
            await flush();
        }
        expect(files.has('Exports/day1.md')).toBe(false);
        expect(files.has('Exports/day.md')).toBe(true);
        expect(settings.markdownExportRecords['Exports/day.md']?.source).toBe('Notes/day.note');
        expect(settings.markdownExportPendingMove).toBeNull();
        expect(report).not.toHaveBeenCalled();
    });

    it.each(['before intent', 'after intent'])('moves a Markdown export after an exact note-link rewrite %s', async (timing) => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'note' });
        convert.mockImplementation(async (file) => `See [[${file.path}]] and [[${file.path.split('/').pop()}]]`);
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        const rewritten = 'See [[Notes/new.note]] and [[new.note]]';
        if (timing === 'before intent') files.get('Exports/day.md')!.content = rewritten;
        else save.mockImplementationOnce(async () => {
            if (settings.markdownExportPendingMove) files.get('Exports/day.md')!.content = rewritten;
        });
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: 'note' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.has('Exports/day.md')).toBe(false);
        expect(files.get('Exports/new.md')?.content).toBe(rewritten);
        expect(settings.markdownExportPendingMove).toBeNull();
        expect(settings.markdownExportBlockedSources[source.path]).toBeUndefined();
        expect(report).not.toHaveBeenCalled();
    });

    it('protects a managed export changed while a reverse rename is pending', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/day1.note';
        files.set(source.path, { file: source, content: 'first' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        save.mockImplementationOnce(async () => {
            if (settings.markdownExportPendingMove) files.get('Exports/day1.md')!.content = 'changed during rename';
        });
        files.delete(source.path);
        source.path = 'Notes/day.note';
        files.set(source.path, { file: source, content: 'first' });
        exporter.rename(source, 'Notes/day1.note');
        await flush();
        expect(files.get('Exports/day1.md')?.content).toBe('changed during rename');
        expect(files.has('Exports/day.md')).toBe(false);
        expect(settings.markdownExportPendingMove?.from.destination).toBe('Exports/day1.md');
        expect(report).toHaveBeenCalledOnce();
        expect(report).toHaveBeenCalledWith(source.path, 'Exports/day.md', expect.stringContaining('review both locations before resuming'));
    });

    it('records the pending-save, Markdown-modify, second-read ordering without claiming the changed file', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        const events: string[] = [];
        const vault = (app as { vault: {
            read: (file: FakeFile) => Promise<string>;
            rename: (file: FakeFile, destination: string) => Promise<void>;
        } }).vault;
        const read = vault.read;
        const rename = vault.rename;
        vault.read = async (file) => {
            if (file.extension === 'md') events.push('markdown read');
            return read(file);
        };
        vault.rename = async (file, destination) => {
            if (file.extension === 'md') events.push('markdown rename');
            return rename(file, destination);
        };
        save.mockImplementation(async () => {
            if (settings.markdownExportPendingMove && !events.includes('intent saved')) {
                events.push('intent saved');
                files.get('Exports/day.md')!.content = 'changed by another writer';
                events.push('markdown modified');
            }
        });
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: 'first' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(events).toEqual(['markdown read', 'intent saved', 'markdown modified',
            'markdown read', 'markdown read']);
        expect(settings.markdownExportPendingMove?.to.destination).toBe('Exports/new.md');
        expect(files.has('Exports/new.md')).toBe(false);
        expect(settings.markdownExportBlockedSources[source.path]).toBe('Exports/new.md');
    });

    it('keeps an edited export in place on rename and handles root beside-source files', async () => {
        settings.markdownExportMappings = [{ id: 'root', enabled: true, watchDir: '', outputDir: '' }];
        const source = new FakeFile('day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.get('day.md')!.content = 'edited';
        files.delete('day.note');
        source.path = 'renamed.note';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'day.note');
        await flush();
        expect(files.get('day.md')?.content).toBe('edited');
        expect(files.has('renamed.md')).toBe(false);
        expect(report).toHaveBeenCalledOnce();
        exporter.schedule(source);
        await flush();
        const reloaded = new AutomaticMarkdownExport(app, settings, save, convert, report);
        reloaded.schedule(source);
        await flush();
        expect(files.has('renamed.md')).toBe(false);
    });

    it('cancels queued work when disabled and does not move to an occupied target', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        settings.automaticMarkdownExportEnabled = false;
        exporter.settingsChanged();
        await flush();
        expect(files.has('Exports/day.md')).toBe(false);
        settings.automaticMarkdownExportEnabled = true;
        exporter.settingsChanged();
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: '' });
        files.set('Exports/new.md', { file: new FakeFile('Exports/new.md'), content: 'unmanaged' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.get('Exports/day.md')?.content).toContain('day.note');
        expect(files.get('Exports/new.md')?.content).toBe('unmanaged');
        expect(report).toHaveBeenCalledOnce();
    });

    it('recovers ownership after a moved file was saved before its record transfer', async () => {
        const source = new FakeFile('Notes/new.note');
        files.set(source.path, { file: source, content: '' });
        const previous = 'Notes/day.note -> Exports/day.md';
        const { hashBytes } = await import('./sync/directIP/deviceSync');
        const record = { mappingId: 'one', source: 'Notes/day.note', destination: 'Exports/day.md',
            hash: hashBytes(new TextEncoder().encode(previous)) };
        settings.markdownExportRecords = { 'Exports/day.md': record };
        settings.markdownExportPendingMove = { from: record, to: { ...record, source: source.path, destination: 'Exports/new.md' } };
        files.set('Exports/new.md', { file: new FakeFile('Exports/new.md'), content: previous });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        await exporter.recover();
        exporter.schedule(source);
        await flush();
        expect(settings.markdownExportPendingMove).toBeNull();
        expect(settings.markdownExportRecords['Exports/day.md']).toBeUndefined();
        expect(files.get('Exports/new.md')?.content).toBe('Notes/new.note -> Exports/new.md');
    });

    it('does not move when the pending-move record cannot be saved', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: '' });
        save.mockRejectedValueOnce(new Error('disk full'));
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.has('Exports/day.md')).toBe(true);
        expect(files.has('Exports/new.md')).toBe(false);
        expect(settings.markdownExportPendingMove).toBeNull();
        expect(report).toHaveBeenCalledOnce();
    });

    it('does not transfer ownership of an edited output on a case-changing rename', async () => {
        settings.markdownExportMappings = [{ id: 'one', enabled: true, watchDir: '', outputDir: 'Exports' }];
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.get('Exports/Notes/day.md')!.content = 'edited';
        files.delete(source.path);
        source.path = 'Notes/day.NOTE';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(settings.markdownExportRecords['Exports/Notes/day.md']?.source).toBe('Notes/day.note');
        expect(files.get('Exports/Notes/day.md')?.content).toBe('edited');
    });

    it('exports a note renamed into scope without a modify event and leaves an export when renamed out', async () => {
        const source = new FakeFile('Outside/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        files.delete(source.path);
        source.path = 'Notes/day.note';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Outside/day.note');
        await flush();
        expect(files.get('Exports/day.md')?.content).toContain('Notes/day.note');
        files.delete(source.path);
        source.path = 'Outside/day.note';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.get('Exports/day.md')?.content).toContain('Notes/day.note');
        expect(report).not.toHaveBeenCalled();
    });

    it('leaves managed Markdown untouched when a note becomes a different file type', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/day.txt';
        source.extension = 'txt';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.get('Exports/day.md')?.content).toContain('Notes/day.note');
        expect(files.has('Exports/day.txt')).toBe(false);
        expect(convert).toHaveBeenCalledOnce();
    });

    it('writes beside a nested source without stripping its watched folder', async () => {
        settings.markdownExportMappings[0].outputDir = '';
        const source = new FakeFile('Notes/Journal/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        expect(files.get('Notes/Journal/day.md')?.content).toBe('Notes/Journal/day.note -> Notes/Journal/day.md');
    });

    it('moves a managed export when a modify follows its rename before the queue runs', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Notes/day.note');
        exporter.schedule(source);
        await flush();
        expect(files.has('Exports/day.md')).toBe(false);
        expect(files.get('Exports/new.md')?.content).toBe('Notes/new.note -> Exports/new.md');
        expect(report).not.toHaveBeenCalled();
    });

    it('drops an in-flight conversion when settings change and then change back', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        let finish!: (content: string) => void;
        convert.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await vi.advanceTimersByTimeAsync(250);
        settings.automaticMarkdownExportEnabled = false;
        exporter.settingsChanged();
        settings.automaticMarkdownExportEnabled = true;
        exporter.settingsChanged();
        finish('stale output');
        await flush();
        expect(files.has('Exports/day.md')).toBe(false);
    });

    it('converts the latest source bytes when the file changes during conversion', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        let finish!: (content: string) => void;
        convert.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
        convert.mockImplementationOnce(async (_file, _path, bytes) => new TextDecoder().decode(bytes));
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await vi.advanceTimersByTimeAsync(250);
        files.get(source.path)!.content = 'second';
        finish('stale');
        await flush();
        expect(files.get('Exports/day.md')?.content).toBe('second');
        expect(convert).toHaveBeenCalledTimes(2);
    });

    it('leaves the original ownership intact if the destination move fails', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: '' });
        const vault = (app as { vault: { rename: (file: FakeFile, path: string) => Promise<void> } }).vault;
        vault.rename = vi.fn(async () => { throw new Error('move failed'); });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.has('Exports/day.md')).toBe(true);
        expect(files.has('Exports/new.md')).toBe(false);
        expect(settings.markdownExportRecords['Exports/day.md']?.source).toBe('Notes/day.note');
        expect(settings.markdownExportPendingMove?.to.destination).toBe('Exports/new.md');
        expect(settings.markdownExportBlockedSources['Notes/new.note']).toBe('Exports/new.md');
    });

    it('does not move a prepared export after automatic export is disabled', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/sub/new.note';
        files.set(source.path, { file: source, content: '' });
        const vault = (app as { vault: { createFolder: (path: string) => Promise<void> } }).vault;
        vault.createFolder = vi.fn(async () => {
            settings.automaticMarkdownExportEnabled = false;
            exporter.settingsChanged();
        });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.has('Exports/day.md')).toBe(true);
        expect(files.has('Exports/sub/new.md')).toBe(false);
        expect(settings.markdownExportPendingMove).toBeNull();
    });

    it('does not treat an output at a newly mapped path as owned', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        settings.markdownExportMappings = [{ ...settings.markdownExportMappings[0], outputDir: 'Elsewhere' }];
        files.set('Elsewhere/day.md', { file: new FakeFile('Elsewhere/day.md'), content: 'private' });
        exporter.settingsChanged();
        exporter.schedule(source);
        await flush();
        expect(files.get('Exports/day.md')?.content).toContain('Notes/day.note');
        expect(files.get('Elsewhere/day.md')?.content).toBe('private');
        expect(report).toHaveBeenCalledOnce();
    });

    it('retries a verified pending move after restart and refreshes its links', async () => {
        const source = new FakeFile('Notes/new.note');
        files.set(source.path, { file: source, content: '' });
        const previous = 'Notes/day.note -> Exports/day.md';
        const { hashBytes } = await import('./sync/directIP/deviceSync');
        const record = { mappingId: 'one', source: 'Notes/day.note', destination: 'Exports/day.md',
            hash: hashBytes(new TextEncoder().encode(previous)) };
        settings.markdownExportRecords = { 'Exports/day.md': record };
        settings.markdownExportPendingMove = { from: record, to: { ...record, source: source.path, destination: 'Exports/new.md' } };
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: previous });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        await exporter.recover();
        await flush();
        expect(settings.markdownExportPendingMove).toBeNull();
        expect(files.has('Exports/day.md')).toBe(false);
        expect(files.get('Exports/new.md')?.content).toBe('Notes/new.note -> Exports/new.md');
    });

    it('recovers a pending rename after only the linked note path changes', async () => {
        const source = new FakeFile('Notes/new.note');
        files.set(source.path, { file: source, content: 'note' });
        const previous = 'See [[Notes/day.note]]';
        const { hashBytes } = await import('./sync/directIP/deviceSync');
        const record = { mappingId: 'one', source: 'Notes/day.note', destination: 'Exports/day.md',
            hash: hashBytes(new TextEncoder().encode(previous)) };
        settings.markdownExportRecords['Exports/day.md'] = record;
        settings.markdownExportPendingMove = { from: record, to: { ...record, source: source.path, destination: 'Exports/new.md' } };
        settings.markdownExportBlockedSources[source.path] = 'Exports/new.md';
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'See [[Notes/new.note]]' });
        convert.mockImplementation(async (file) => `See [[${file.path}]]`);
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        await exporter.recover();
        await flush();
        expect(files.has('Exports/day.md')).toBe(false);
        expect(files.get('Exports/new.md')?.content).toBe('See [[Notes/new.note]]');
        expect(settings.markdownExportPendingMove).toBeNull();
        expect(settings.markdownExportBlockedSources[source.path]).toBeUndefined();
        expect(report).not.toHaveBeenCalled();
    });

    it.each(['disabled', 'missing source'])('leaves a pending move untouched after restart with %s', async (state) => {
        const source = new FakeFile('Notes/new.note');
        if (state !== 'missing source') files.set(source.path, { file: source, content: '' });
        if (state === 'disabled') settings.automaticMarkdownExportEnabled = false;
        const previous = 'original export';
        const { hashBytes } = await import('./sync/directIP/deviceSync');
        const record = { mappingId: 'one', source: 'Notes/day.note', destination: 'Exports/day.md',
            hash: hashBytes(new TextEncoder().encode(previous)) };
        settings.markdownExportRecords = { 'Exports/day.md': record };
        settings.markdownExportPendingMove = { from: record, to: { ...record, source: source.path, destination: 'Exports/new.md' } };
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: previous });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        await exporter.recover();
        expect(files.get('Exports/day.md')?.content).toBe(previous);
        expect(files.has('Exports/new.md')).toBe(false);
        expect(settings.markdownExportPendingMove?.from).toEqual(record);
        expect(settings.markdownExportBlockedSources[source.path]).toBe('Exports/new.md');
        expect(report).toHaveBeenCalledWith(source.path, 'Exports/new.md', expect.stringContaining('source is missing or automatic export mapping changed'));
    });

    it('does not create a new export after renaming a source with an unmanaged old output', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'private' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        expect(files.get('Exports/day.md')?.content).toBe('private');
        expect(files.has('Exports/new.md')).toBe(false);
        expect(report).toHaveBeenCalledOnce();
    });

    it('transfers the first managed export across consecutive renames', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/middle.note';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Notes/day.note');
        files.delete(source.path);
        source.path = 'Notes/final.note';
        files.set(source.path, { file: source, content: '' });
        exporter.rename(source, 'Notes/middle.note');
        await flush();
        expect(files.has('Exports/day.md')).toBe(false);
        expect(files.get('Exports/final.md')?.content).toBe('Notes/final.note -> Exports/final.md');
        expect(report).not.toHaveBeenCalled();
    });

    it('writes errors only to each pair root and bounds repeated log entries', async () => {
        settings.markdownExportMappings = [
            { id: 'one', name: 'First', enabled: true, watchDir: 'Notes', outputDir: 'Exports' },
            { id: 'two', name: 'Second', enabled: true, watchDir: 'Other', outputDir: '' },
        ];
        const first = new FakeFile('Notes/day.note');
        const second = new FakeFile('Other/day.note');
        files.set(first.path, { file: first, content: '' });
        files.set(second.path, { file: second, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(first);
        await flush();
        expect(files.has('Exports/Markdown Export Log.md')).toBe(false);
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'private' });
        files.set('Other/day.md', { file: new FakeFile('Other/day.md'), content: 'private' });
        exporter.schedule(first);
        exporter.schedule(second);
        await flush();
        expect(files.get('Exports/Markdown Export Log.md')?.content).toContain('Mapping: First (one)');
        expect(files.get('Markdown Export Log.md')?.content).toContain('Mapping: Second (two)');
        expect(files.has('Other/Markdown Export Log.md')).toBe(false);
        for (let index = 0; index < 10; index++) {
            files.get(first.path)!.content = `${index}`;
            convert.mockRejectedValueOnce(new Error(`failure ${index}`));
            exporter.schedule(first);
            await flush();
        }
        const log = files.get('Exports/Markdown Export Log.md')!.content;
        expect(log.match(/^## /gm)).toHaveLength(8);
        expect(log).toContain('failure 9');
        expect(log).not.toContain('failure 0');
    });

    it('preserves logs when disabled and reports an occupied log path separately', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'private' });
        files.set('Exports/Markdown Export Log.md', { file: new FakeFile('Exports/Markdown Export Log.md'), content: 'previous log' });
        settings.markdownExportErrorLogEnabled = false;
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        expect(report).toHaveBeenCalledOnce();
        expect(files.get('Exports/Markdown Export Log.md')?.content).toBe('previous log');
        settings.markdownExportErrorLogEnabled = true;
        files.set('Exports/Markdown Export Log.md', { file: new FakeFile('Exports/Markdown Export Log.md'), content: 'occupied' });
        convert.mockRejectedValueOnce(new Error('conversion failed'));
        exporter.schedule(source);
        await flush();
        expect(report).toHaveBeenCalledWith(source.path, 'Exports/day.md', 'conversion failed');
        expect(report).toHaveBeenCalledWith(source.path, 'Exports/day.md', expect.stringContaining('Could not write Markdown export log'));
        expect(files.get('Exports/Markdown Export Log.md')?.content).toBe('occupied');
    });

    it('resumes a reviewed destination without writing it and allows the next change', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: 'first' });
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'reviewed edit' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        expect(exporter.resumeCandidate('Exports/day.md')).toEqual({ mapping: 'one', source: source.path, destination: 'Exports/day.md' });
        await exporter.resume('Exports/day.md');
        expect(files.get('Exports/day.md')?.content).toBe('reviewed edit');
        exporter.schedule(source);
        await flush();
        expect(files.get('Exports/day.md')?.content).toBe('reviewed edit');
        files.get(source.path)!.content = 'second';
        exporter.schedule(source);
        await flush();
        expect(files.get('Exports/day.md')?.content).toContain('Notes/day.note');
        expect(report).not.toHaveBeenCalled();
    });

    it('keeps rename conflicts blocked if resume cannot be persisted', async () => {
        const source = new FakeFile('Notes/new.note');
        files.set(source.path, { file: source, content: '' });
        files.set('Exports/new.md', { file: new FakeFile('Exports/new.md'), content: 'reviewed' });
        settings.markdownExportBlockedSources[source.path] = 'Exports/new.md';
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        save.mockRejectedValueOnce(new Error('disk full'));
        await expect(exporter.resume('Exports/new.md')).rejects.toThrow('disk full');
        expect(settings.markdownExportBlockedSources[source.path]).toBe('Exports/new.md');
        expect(settings.markdownExportRecords['Exports/new.md']).toBeUndefined();
        exporter.schedule(source);
        await flush();
        expect(files.get('Exports/new.md')?.content).toBe('reviewed');
        await exporter.resume('Exports/new.md');
        expect(settings.markdownExportBlockedSources[source.path]).toBeUndefined();
        const reloaded = new AutomaticMarkdownExport(app, settings, save, convert, report);
        reloaded.schedule(source);
        await flush();
        expect(files.get('Exports/new.md')?.content).toBe('reviewed');
        files.get(source.path)!.content = 'changed';
        reloaded.schedule(source);
        await flush();
        expect(files.get('Exports/new.md')?.content).toContain('Notes/new.note');
    });

    it('does not resume at a second destination while a pending move still owns the original', async () => {
        const source = new FakeFile('Notes/new.note');
        files.set(source.path, { file: source, content: 'note' });
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'edited original' });
        files.set('Exports/new.md', { file: new FakeFile('Exports/new.md'), content: 'reviewed replacement' });
        const record = { mappingId: 'one', source: 'Notes/day.note', destination: 'Exports/day.md', hash: 'old hash' };
        settings.markdownExportRecords['Exports/day.md'] = record;
        settings.markdownExportPendingMove = { from: record, to: { ...record, source: source.path, destination: 'Exports/new.md' } };
        settings.markdownExportBlockedSources[source.path] = 'Exports/new.md';
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        await expect(exporter.resume('Exports/new.md')).rejects.toThrow('original Markdown export still exists');
        expect(settings.markdownExportRecords).toEqual({ 'Exports/day.md': record });
        expect(settings.markdownExportPendingMove?.from).toEqual(record);
        expect(settings.markdownExportBlockedSources[source.path]).toBe('Exports/new.md');
        expect(save).not.toHaveBeenCalled();
    });

    it('regenerates only the missing export after a blocked rename back to the original note', async () => {
        const source = new FakeFile('Notes/day1.note');
        files.set(source.path, { file: source, content: 'note' });
        const oldRecord = { mappingId: 'one', source: 'Notes/day1.note', destination: 'Exports/day1.md', hash: 'saved' };
        settings.markdownExportRecords['Exports/day1.md'] = oldRecord;
        settings.markdownExportPendingMove = { from: oldRecord, to: { ...oldRecord, source: 'Notes/day.note', destination: 'Exports/day.md' } };
        settings.markdownExportBlockedSources['Notes/day.note'] = 'Exports/day.md';
        settings.markdownExportBlockedSources[source.path] = 'Exports/day1.md';
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        expect(exporter.missingExportCandidate(source.path)?.destination).toBe('Exports/day1.md');
        await exporter.restartMissingExport(source.path);
        await flush();
        expect(files.get('Exports/day1.md')?.content).toContain('Notes/day1.note');
        expect(settings.markdownExportRecords['Exports/day1.md']?.source).toBe(source.path);
        expect(settings.markdownExportPendingMove).toBeNull();
        expect(settings.markdownExportBlockedSources).toEqual({});
        expect(files.has('Exports/day.md')).toBe(false);
    });

    it('refuses to discard missing-export history if a related destination exists or save fails', async () => {
        const source = new FakeFile('Notes/day1.note');
        files.set(source.path, { file: source, content: 'note' });
        const record = { mappingId: 'one', source: source.path, destination: 'Exports/day1.md', hash: 'saved' };
        settings.markdownExportRecords['Exports/day1.md'] = record;
        settings.markdownExportPendingMove = { from: record, to: { ...record, source: 'Notes/day.note', destination: 'Exports/day.md' } };
        settings.markdownExportBlockedSources[source.path] = 'Exports/day1.md';
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'keep' });
        expect(exporter.missingExportCandidate(source.path)).toBeUndefined();
        await expect(exporter.restartMissingExport(source.path)).rejects.toThrow('changed');
        expect(files.get('Exports/day.md')?.content).toBe('keep');
        files.delete('Exports/day.md');
        save.mockRejectedValueOnce(new Error('disk full'));
        await expect(exporter.restartMissingExport(source.path)).rejects.toThrow('disk full');
        expect(settings.markdownExportRecords['Exports/day1.md']).toEqual(record);
        expect(settings.markdownExportPendingMove?.from).toEqual(record);
        expect(settings.markdownExportBlockedSources[source.path]).toBe('Exports/day1.md');
        expect(files.has('Exports/day1.md')).toBe(false);
    });

    it('leaves unrelated export conflicts and attachment-bearing history untouched', async () => {
        const source = new FakeFile('Notes/day1.note');
        files.set(source.path, { file: source, content: 'note' });
        const record = { mappingId: 'one', source: source.path, destination: 'Exports/day1.md', hash: 'saved' };
        settings.markdownExportRecords['Exports/day1.md'] = record;
        settings.markdownExportBlockedSources[source.path] = 'Exports/other.md';
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        expect(exporter.missingExportCandidate(source.path)).toBeUndefined();
        settings.markdownExportBlockedSources[source.path] = 'Exports/day1.md';
        settings.markdownExportRecords['Exports/day1.md'] = { ...record, attachments: { 'Exports/day1-pages/1.png': 'saved' } };
        expect(exporter.missingExportCandidate(source.path)).toBeUndefined();
        expect(settings.markdownExportRecords['Exports/day1.md'].attachments).toBeDefined();
        expect(save).not.toHaveBeenCalled();
    });

    it('shares a vault-root error log across beside-source pairs without duplicate notices', async () => {
        settings.markdownExportMappings = [
            { id: 'one', enabled: true, watchDir: 'Notes', outputDir: '' },
            { id: 'two', enabled: true, watchDir: 'Other', outputDir: '' },
        ];
        for (const folder of ['Notes', 'Other']) {
            const source = new FakeFile(`${folder}/day.note`);
            files.set(source.path, { file: source, content: '' });
            files.set(`${folder}/day.md`, { file: new FakeFile(`${folder}/day.md`), content: 'private' });
        }
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        for (const folder of ['Notes', 'Other']) exporter.schedule(files.get(`${folder}/day.note`)!.file);
        await flush();
        const log = files.get('Markdown Export Log.md')!.content;
        expect(log).toContain('Mapping: one (one)');
        expect(log).toContain('Mapping: two (two)');
        expect(log.match(/^## /gm)).toHaveLength(2);
        exporter.schedule(files.get('Notes/day.note')!.file);
        await flush();
        expect(report).toHaveBeenCalledTimes(2);
        expect(files.get('Markdown Export Log.md')?.content).toBe(log);
    });

    it('keeps a rename block after reload until the reviewed file is resumed', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        await flush();
        files.delete(source.path);
        source.path = 'Notes/new.note';
        files.set(source.path, { file: source, content: '' });
        files.set('Exports/new.md', { file: new FakeFile('Exports/new.md'), content: 'reviewed' });
        exporter.rename(source, 'Notes/day.note');
        await flush();
        const reloaded = new AutomaticMarkdownExport(app, settings, save, convert, report);
        reloaded.schedule(source);
        await flush();
        expect(files.get('Exports/new.md')?.content).toBe('reviewed');
        expect(settings.markdownExportBlockedSources[source.path]).toBe('Exports/new.md');
        await reloaded.resume('Exports/new.md');
        expect(files.get('Exports/new.md')?.content).toBe('reviewed');
        files.get(source.path)!.content = 'changed';
        reloaded.schedule(source);
        await flush();
        expect(files.get('Exports/new.md')?.content).toContain('Notes/new.note');
        expect(files.get('Exports/day.md')?.content).toContain('Notes/day.note');
    });

    it('notifies once for an invalid output root without writing a fallback log', async () => {
        settings.markdownExportMappings[0].outputDir = '../outside';
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        exporter.schedule(source);
        exporter.schedule(source);
        await flush();
        expect(report).toHaveBeenCalledOnce();
        expect(report).toHaveBeenCalledWith(source.path, source.path, expect.stringContaining('Invalid automatic Markdown export settings'));
        expect(files.has('Markdown Export Log.md')).toBe(false);
        expect(convert).not.toHaveBeenCalled();
    });

    it('rejects resuming a remapped destination and keeps its existing output', async () => {
        const source = new FakeFile('Notes/day.note');
        files.set(source.path, { file: source, content: '' });
        files.set('Exports/day.md', { file: new FakeFile('Exports/day.md'), content: 'private' });
        const exporter = new AutomaticMarkdownExport(app, settings, save, convert, report);
        settings.markdownExportMappings[0].outputDir = 'Elsewhere';
        await expect(exporter.resume('Exports/day.md')).rejects.toThrow('changed');
        expect(settings.markdownExportRecords).toEqual({});
        expect(files.get('Exports/day.md')?.content).toBe('private');
    });
});