// This entry is bundled only by test-device-sync.mjs with a tiny Node shim for
// Obsidian. It deliberately imports the plugin's real Browse & Access and sync
// modules, rather than reproducing their URI encoding or sync behavior here.
//
// Supernote may migrate an uploaded .note to its current on-device format.
// Therefore this test checks that sync mirrors the bytes subsequently served
// by the device, not that an older fixture remains byte-identical after import.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { App, TFile } from 'obsidian';
import { fetchSupernoteDirectory, scanDeviceSupernoteTree } from '../src/FileListModal';
import { buildMultipartBody, DEVICE_TRANSFER_TIMEOUT_MS, fetchFromDevice } from '../src/deviceFetch';
import { runDeviceSync } from '../src/syncEngine';
import type { SupernotePluginSettings } from '../src/settings';

const ip = process.env.SUPERNOTE_DEVICE_IP;
const testDirectory = process.env.SUPERNOTE_TEST_DIR;
const fixturePath = resolve('supernote-typescript/tests/input/blank-n5-20230015-manta.note');

if (!ip || !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip)) {
    throw new Error('Set SUPERNOTE_DEVICE_IP to your device’s dotted-quad IP address.');
}
if (!testDirectory || !/^\/Note\/[^/]+(?:\/[^/]+)*$/.test(testDirectory) || testDirectory.includes('..')) {
    throw new Error('Set SUPERNOTE_TEST_DIR to an existing dedicated subdirectory of /Note; it must not contain "..".');
}

// deviceFetch.ts uses the browser's window timer API. Node has the same timer
// methods on globalThis, so the test shim only needs to expose it as window.
Object.assign(globalThis, { window: globalThis });

interface MemoryFile extends TFile {
    bytes?: ArrayBuffer;
    text?: string;
}

const folders = new Set<string>();
const files = new Map<string, MemoryFile>();
const vault = {
    getAbstractFileByPath(path: string): MemoryFile | { path: string } | null {
        return files.get(path) ?? (folders.has(path) ? { path } : null);
    },
    async createFolder(path: string): Promise<void> {
        folders.add(path);
    },
    async createBinary(path: string, bytes: ArrayBuffer): Promise<MemoryFile> {
        const file = new TFile(path) as MemoryFile;
        file.bytes = bytes;
        files.set(path, file);
        return file;
    },
    async modifyBinary(file: MemoryFile, bytes: ArrayBuffer): Promise<void> {
        file.bytes = bytes;
    },
    async readBinary(file: MemoryFile): Promise<ArrayBuffer> {
        if (!file.bytes) throw new Error(`No bytes stored for ${file.path}`);
        return file.bytes;
    },
    async create(path: string, text: string): Promise<MemoryFile> {
        const file = new TFile(path) as MemoryFile;
        file.text = text;
        files.set(path, file);
        return file;
    },
    async append(file: MemoryFile, text: string): Promise<void> {
        file.text = (file.text ?? '') + text;
    },
};
const app = { vault } as unknown as App;

const fixture = await readFile(fixturePath);
const directoryLeafName = testDirectory.split('/').at(-1);

// Safe, syncable filename cases used by the path, fetch, listing, and sync
// unit tests. The traversal/backslash examples in those tests deliberately
// model malicious listings, not names a real device should be asked to store.
const namingCases = [
    'Work Journal.note',
    'C++.note',
    'Substack Notes.note',
    'a b.note',
    'a+b(1).note',
];

const parentDirectory = testDirectory.slice(0, testDirectory.lastIndexOf('/'));
const parentLeafName = parentDirectory.split('/').at(-1);
console.log(`Checking dedicated device directory ${testDirectory}…`);
const parentEntries = await fetchSupernoteDirectory(ip, parentDirectory, parentLeafName);
if (!parentEntries.some((entry) => entry.isDirectory && entry.name === directoryLeafName)) {
    throw new Error(
        `${testDirectory} does not exist on the device. Create this dedicated folder on the Supernote, then rerun with SUPERNOTE_TEST_DIR=${testDirectory}.`,
    );
}
let listed = await fetchSupernoteDirectory(ip, testDirectory, directoryLeafName);
const fixtureBuffer = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
const fixtureHash = createHash('sha256').update(fixture).digest('hex');
const uploadedNames = new Set<string>();

for (const filename of namingCases) {
    if (listed.some((file) => file.name === filename && !file.isDirectory)) {
        console.log(`Keeping existing ${filename}; it will still be downloaded and synced.`);
        continue;
    }

    const { body, contentType } = buildMultipartBody('file', filename, 'application/octet-stream', fixtureBuffer);
    console.log(`Uploading ${filename} (${fixture.length} bytes) through src/deviceFetch.ts…`);
    const uploadResponse = await fetchFromDevice(ip, testDirectory, `Failed to upload ${filename}`, {
        method: 'POST',
        body,
        contentType,
        timeoutMs: DEVICE_TRANSFER_TIMEOUT_MS,
        pathLeafName: directoryLeafName,
    });
    if (!uploadResponse.ok) throw new Error(`Upload failed with HTTP ${uploadResponse.status}`);
    uploadedNames.add(filename);
    listed = await fetchSupernoteDirectory(ip, testDirectory, directoryLeafName);
}

const listedDeviceFiles = namingCases.map((filename) => {
    const file = listed.find((candidate) => candidate.name === filename && !candidate.isDirectory);
    if (!file) throw new Error(`Upload succeeded but ${filename} was absent from the device listing.`);
    console.log(`Device listed ${filename} as ${file.uri}`);
    return file;
});
// Use the actual recursive scanner's entries below so direct pre-sync downloads
// get the same parent-directory display names that runDeviceSync receives.
const scannedFiles = await scanDeviceSupernoteTree(ip);
const deviceFiles = listedDeviceFiles.map((listedFile) => {
    const scannedFile = scannedFiles.find((file) => file.uri === listedFile.uri);
    if (!scannedFile) throw new Error(`Recursive scan did not find ${listedFile.uri}.`);
    return scannedFile;
});

// Read each listing URI through the actual request helper before sync. This
// gives the subsequent in-memory-vault assertion an independent byte source,
// while exercising each encoded URI form on the real Browse & Access server.
const deviceHashes = new Map<string, string>();
for (const file of deviceFiles) {
    const response = await fetchFromDevice(ip, file.uri, `Failed to download ${file.name}`, {
        timeoutMs: DEVICE_TRANSFER_TIMEOUT_MS,
        pathLeafName: file.name,
        pathDirectoryNames: file.directoryNames,
    });
    if (!response.ok) throw new Error(`Download failed for ${file.name} with HTTP ${response.status}`);
    const deviceBytes = new Uint8Array(await response.arrayBuffer());
    if (!/^(?:mark|note)SN_FILE_VER_\d{8}/.test(new TextDecoder().decode(deviceBytes.subarray(0, 24)))) {
        throw new Error(`Download for ${file.name} is not a Supernote file; check encoded parent directory paths.`);
    }
    const deviceHash = createHash('sha256').update(deviceBytes).digest('hex');
    if (uploadedNames.has(file.name) && deviceHash !== fixtureHash) {
        console.log(`Device migrated ${file.name} during import; syncing its device-served bytes.`);
    }
    deviceHashes.set(file.uri, deviceHash);
}

const settings = {
    directConnectIP: ip,
    // Deliberately use the decoded directory name and a recursive wildcard:
    // this is the real settings form for syncing a folder whose listing URI
    // represents spaces as `+`.
    syncPathFiltersRaw: `${testDirectory}/**`,
    syncFolder: 'Supernote device integration test',
    noteSyncState: {},
} as SupernotePluginSettings;
let saves = 0;
console.log('Running src/syncEngine.ts against the device…');
const result = await runDeviceSync(app, settings, async () => { saves++; });
if (result.synced !== deviceFiles.length || result.failed.length !== 0 || saves !== 1) {
    throw new Error(`Unexpected sync result: ${JSON.stringify({ result, saves })}`);
}

for (const file of deviceFiles) {
    const record = settings.noteSyncState[file.uri];
    if (!record) throw new Error(`Sync completed without recording ${file.uri}.`);
    const expectedVaultPath = `${settings.syncFolder}/${testDirectory.slice(1)}/${file.name}`;
    if (record.vaultPath !== expectedVaultPath) {
        throw new Error(`Expected ${expectedVaultPath}, got ${record.vaultPath}.`);
    }
    const synced = files.get(record.vaultPath);
    if (!synced?.bytes) throw new Error(`Sync did not write ${record.vaultPath} to the in-memory vault.`);
    const syncedHash = createHash('sha256').update(new Uint8Array(synced.bytes)).digest('hex');
    if (syncedHash !== deviceHashes.get(file.uri)) {
        throw new Error(`Synced bytes for ${file.name} differ from its direct device download.`);
    }
}

console.log(`PASS: actual plugin upload, listing, filter, download, and sync code mirrored ${deviceFiles.length} device-served naming cases byte-for-byte.`);
console.log(`The fixture files remain in ${testDirectory}; remove them manually when finished.`);
