import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanDevicePdfAnnotationTree, scanDeviceSupernoteTree } from './FileListModal';
import { fetchFromDevice } from './deviceFetch';

vi.mock('obsidian', () => ({
    // FileListModal (extends SuggestModal) and its transitive imports
    // (ErrorModal extends Modal, settings.ts extends PluginSettingTab) need
    // these at module scope; everything else is only referenced inside class
    // methods that these tests never run.
    SuggestModal: class { },
    Modal: class { },
    Notice: class { },
    MarkdownView: class { },
    PluginSettingTab: class { },
}));

vi.mock('./deviceFetch', () => ({
    fetchFromDevice: vi.fn(),
    buildMultipartBody: vi.fn(),
    DEVICE_TRANSFER_TIMEOUT_MS: 120_000,
}));

// Builds one device "Browse and Access" directory-listing response whose
// HTML embeds the given entries as JSON, in the exact shape
// fetchSupernoteDirectory parses back out. (Avoid `'` in names — the device
// embeds the JSON inside a single-quoted JS string.)
function mockListing(entries: { name: string; uri?: string; isDirectory?: boolean }[]) {
    const fileList = entries.map((e) => ({
        name: e.name,
        size: 1,
        date: '2026/01/01 12:00',
        uri: e.uri ?? `/${e.name}`,
        extension: 'note',
        isDirectory: e.isDirectory ?? false,
    }));
    const json = JSON.stringify({
        deviceName: 'A5X',
        fileList,
        routeList: [],
        totalByteSize: 0,
        totalMemory: 0,
        usedMemory: 0,
    });
    return {
        ok: true,
        status: 200,
        text: async () => `const json = '${json}'`,
        arrayBuffer: async () => new ArrayBuffer(0),
    };
}

describe('scanDeviceSupernoteTree entry trust (GHSA-3gx3-r874-5pp4 follow-up)', () => {
    beforeEach(() => {
        vi.mocked(fetchFromDevice).mockReset();
    });

    it('keeps well-formed entries', async () => {
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: 'diary.note' },
            { name: 'sketch.spd' },
            { name: 'paper.pdf' },
            { name: 'paper.pdf.mark' },
        ]));

        const files = await scanDeviceSupernoteTree('192.168.1.50');

        expect(files.map((f) => f.name).sort()).toEqual(['diary.note', 'sketch.spd']);
    });

    it('finds PDF documents and mark sidecars for annotation sync', async () => {
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: 'diary.note' },
            { name: 'paper.pdf' },
            { name: 'paper.pdf.mark' },
        ]));

        const files = await scanDevicePdfAnnotationTree('192.168.1.50');

        expect(files.map((f) => f.name).sort()).toEqual(['paper.pdf', 'paper.pdf.mark']);
    });

    it('ignores PDFs and mark sidecars without their matching companion', async () => {
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: 'paired.pdf' },
            { name: 'paired.pdf.mark' },
            { name: 'plain.pdf' },
            { name: 'orphan.pdf.mark' },
        ]));

        const files = await scanDevicePdfAnnotationTree('192.168.1.50');

        expect(files.map((f) => f.name).sort()).toEqual(['paired.pdf', 'paired.pdf.mark']);
    });

    it('keeps entries whose uri percent-encodes spaces in the filename', async () => {
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: 'Work Journal.note', uri: '/Note/Work%20Journal.note' },
            { name: 'Work Journal.note', uri: '/Note/Work Journal.note' },
        ]));

        const files = await scanDeviceSupernoteTree('192.168.1.50');

        expect(files.map((f) => f.name).sort()).toEqual(['Work Journal.note', 'Work Journal.note']);
    });

    it('keeps entries whose uri uses plus signs for spaces in the filename', async () => {
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: 'Substack Notes.note', uri: '/Note/Substack+Notes.note' },
        ]));

        const files = await scanDeviceSupernoteTree('192.168.1.50');

        expect(files.map((f) => f.name)).toEqual(['Substack Notes.note']);
    });

    it('keeps entries whose filename contains literal plus signs', async () => {
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: 'C++.note', uri: '/Note/C++.note' },
        ]));

        expect((await scanDeviceSupernoteTree('192.168.1.50')).map((f) => f.name)).toEqual(['C++.note']);
    });

    it('drops entries whose name and uri disagree on the filename', async () => {
        // name passes the .note filter; the uri it would actually be
        // downloaded from points elsewhere (e.g. carries traversal segments).
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: 'innocent.note', uri: '/../../evil.note' },
        ]));

        expect(await scanDeviceSupernoteTree('192.168.1.50')).toEqual([]);
    });

    it('drops entries whose name contains a forward slash', async () => {
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: '../../../etc/passwd.note', uri: '/Note/../../../etc/passwd.note' },
        ]));

        expect(await scanDeviceSupernoteTree('192.168.1.50')).toEqual([]);
    });

    it('drops entries whose name contains a backslash', async () => {
        // uriMatchesName alone can't see this one: device uris are only split
        // on "/", so a name with "\\" in it still "matches" the uri's final
        // segment. Obsidian path normalization later turns "\\" into "/",
        // making this a traversal once it reaches getAvailablePathForAttachment.
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: '..\\..\\evil.note', uri: '/Note/..\\..\\evil.note' },
        ]));

        expect(await scanDeviceSupernoteTree('192.168.1.50')).toEqual([]);
    });

    it('drops entries named "." or ".."', async () => {
        vi.mocked(fetchFromDevice).mockResolvedValue(mockListing([
            { name: '..', uri: '/Note/..' },
            { name: '.', uri: '/Note/.' },
        ]));

        expect(await scanDeviceSupernoteTree('192.168.1.50')).toEqual([]);
    });

    it('still recurses into directories the listing marks as such', async () => {
        vi.mocked(fetchFromDevice)
            .mockResolvedValueOnce(mockListing([
                { name: 'EXPORT', isDirectory: true, uri: '/EXPORT' },
            ]))
            .mockResolvedValueOnce(mockListing([
                { name: 'inside.note', uri: '/EXPORT/inside.note' },
            ]));

        const files = await scanDeviceSupernoteTree('192.168.1.50');

        expect(files.map((f) => f.name)).toEqual(['inside.note']);
        expect(files[0].directoryNames).toEqual(['EXPORT']);
    });

    it('uses display names from the URI hierarchy when a listing jumps through a route alias', async () => {
        // The real server can reach /Note through a virtual route such as
        // /EXPORT/Home Books/Art, while the Note entry's URI remains /Note.
        vi.mocked(fetchFromDevice)
            .mockResolvedValueOnce(mockListing([{ name: 'EXPORT', isDirectory: true, uri: '/EXPORT' }]))
            .mockResolvedValueOnce(mockListing([{ name: 'Note', isDirectory: true, uri: '/Note' }]))
            .mockResolvedValueOnce(mockListing([{ name: 'test dir', isDirectory: true, uri: '/Note/test+dir' }]))
            .mockResolvedValueOnce(mockListing([
                { name: 'Work Journal.note', uri: '/Note/test+dir/Work+Journal.note' },
            ]));

        const files = await scanDeviceSupernoteTree('192.168.1.50');

        expect(files[0].directoryNames).toEqual(['Note', 'test dir']);
        expect(fetchFromDevice).toHaveBeenLastCalledWith(
            '192.168.1.50',
            '/Note/test+dir',
            'Failed to load file list',
            { pathLeafName: 'test dir', pathDirectoryNames: ['Note'] },
        );
    });
});
