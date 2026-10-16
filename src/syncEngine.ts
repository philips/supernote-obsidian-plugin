import { App, TFile } from 'obsidian';
import { SupernotePluginSettings } from './settings';
import { scanDeviceSupernoteTreeWithExtensions } from './FileListModal';
import { fetchFromDevice, DEVICE_TRANSFER_TIMEOUT_MS } from './deviceFetch';
import {
    DeviceNoteListing,
    planSync,
    deviceUriToVaultPath,
    decideWrite,
    buildSyncRecord,
    parsePathFilters,
    hashBytes,
} from './deviceSync';
import type { SyncEngine, SyncRunResult, SyncTrigger } from './syncAbstraction';
import { ALL_FILE_EXTENSIONS, parseFileExtensionAllowlist } from './syncFilters';
import { ObsidianMirrorManifestStorage } from './cloudSync/obsidianMirrorManifestStorage';
import { loadMirrorManifest } from './cloudSync/sharedMirrorManifestStore';

// Creates every missing intermediate folder in `folderPath`, tolerating a
// concurrent creator (createFolder throwing because another call already
// made it) rather than failing the whole sync run over a race that isn't
// actually a problem.
async function ensureFolder(app: App, folderPath: string): Promise<void> {
    const segments = folderPath.split('/').filter((s) => s.length > 0);
    let current = '';
    for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        if (!app.vault.getAbstractFileByPath(current)) {
            try {
                await app.vault.createFolder(current);
            } catch {
                // Already exists (created concurrently, or a stale check) — fine.
            }
        }
    }
}

// Writes binary content at a deterministic path, overwriting in place if a
// file is already there instead of Obsidian's usual auto-uniquify-on-conflict
// attachment behavior — a re-synced file needs to land at the exact same
// path every time, not a fresh "file 2.note".
async function writeBinaryAt(app: App, path: string, buffer: ArrayBuffer): Promise<void> {
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
        await app.vault.modifyBinary(existing, buffer);
    } else {
        await app.vault.createBinary(path, buffer);
    }
}

export interface DeviceSyncResult {
    synced: number;
    unchanged: number;
    excluded: number;
    skippedConflicts: string[];
    failed: { file: string; error: string }[];
}

export class IpSyncEngine implements SyncEngine {
    readonly id = 'ip-device' as const;
    readonly name = 'Direct IP';

    constructor(
        private readonly app: App,
        private readonly settings: SupernotePluginSettings,
        private readonly saveSettings: () => Promise<void>,
    ) {}

    getReadiness() {
        return this.settings.directConnectIP.length > 0
            ? { ready: true }
            : { ready: false, reason: 'Supernote IP is unset' };
    }

    async run(_trigger: SyncTrigger): Promise<SyncRunResult> {
        let result: DeviceSyncResult;
        try {
            const storage = new ObsidianMirrorManifestStorage(this.app, this.settings.syncFolder);
            if (await storage.read('primary') !== null || await storage.read('backup') !== null) {
                const loaded = await loadMirrorManifest(storage, this.settings.noteSyncState);
                if (loaded.manifest.records && Object.values(loaded.manifest.records)
                    .some((record) => record.source.engineId === 'supernote-cloud')) {
                    throw new Error('IP sync cannot run over Cloud-owned mirror files until shared IP history is integrated');
                }
            }
            result = await runDeviceSync(this.app, this.settings, this.saveSettings);
        } catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
        }
        return {
            engineId: this.id,
            synced: result.synced,
            unchanged: result.unchanged,
            excluded: result.excluded,
            removed: 0,
            issues: [
                ...result.skippedConflicts.map((item) => ({
                    kind: 'protected' as const,
                    item,
                    message: 'Skipped because the vault copy was edited locally',
                })),
                ...result.failed.map(({ file, error }) => ({
                    kind: 'failure' as const,
                    item: file,
                    message: error,
                })),
            ],
        };
    }

    async clearHistory(): Promise<void> {
        this.settings.noteSyncState = {};
        await this.saveSettings();
    }
}

// Reads a vault file's current bytes and hashes them, or returns null if
// there's no file there at all. Shared by the toSync and unchanged passes
// below — both need "what's actually at this path right now" to run
// decideWrite().
async function currentHash(app: App, vaultPath: string): Promise<string | null> {
    const file = app.vault.getAbstractFileByPath(vaultPath);
    if (!(file instanceof TFile)) return null;
    return hashBytes(new Uint8Array(await app.vault.readBinary(file)));
}

// Orchestrates one sync run: list the device tree, plan what needs work
// (planSync — efficiency), mirror anything new or changed guarded by
// decideWrite (safety), check previously-synced-but-unchanged files for local
// drift (cheap, vault-local only — see the loop below), and persist the
// manifest. Deliberately thin — all the actual decision-making lives in
// deviceSync.ts and is unit tested there; this just wires those pure
// decisions up to real device fetches and vault writes. Sync only ever
// copies the raw .note/.spd file byte-for-byte — no rendering, no format
// choice — see deviceSync.ts's top-of-file comment for why.
export async function runDeviceSync(
    app: App,
    settings: SupernotePluginSettings,
    saveSettings: () => Promise<void>,
): Promise<DeviceSyncResult> {
    const ip = settings.directConnectIP;
    if (!ip) {
        throw new Error('Supernote IP is unset');
    }

    const deviceFiles = await scanDeviceSupernoteTreeWithExtensions(ip, ALL_FILE_EXTENSIONS);
    const listings: DeviceNoteListing[] = deviceFiles.map((f) => ({
        uri: f.uri,
        date: f.date,
        size: f.size,
        name: f.name,
    }));
    const patterns = parsePathFilters(settings.syncPathFiltersRaw);
    const fileExtensions = parseFileExtensionAllowlist(settings.syncFileExtensionsRaw ?? '.note, .spd');
    const plan = planSync(listings, settings.noteSyncState, patterns, fileExtensions);
    // A device listing can be unchanged while its vault copy was deleted.
    // Restore those files from the unchanged bucket; a missing file is safe to
    // create, unlike a present file whose hash no longer matches the manifest.
    // Guarded per-file like the loops below: a vault file that can't even be
    // read is one listing's problem, not a reason to abort the whole run —
    // keep it in unchanged (conservatively: don't try to restore over a file
    // we couldn't inspect) and let the drift-check loop report it on its own
    // guarded pass.
    const toSync = [...plan.toSync];
    const unchanged: DeviceNoteListing[] = [];
    for (const listing of plan.unchanged) {
        const record = settings.noteSyncState[listing.uri];
        if (!record) {
            unchanged.push(listing); // 'unchanged' implies a record exists; defensive only.
            continue;
        }
        try {
            if (await currentHash(app, record.vaultPath) === null) {
                toSync.push(listing);
            } else {
                unchanged.push(listing);
            }
        } catch (err) {
            console.error(`Failed to check ${record.vaultPath} for local deletion:`, err);
            unchanged.push(listing);
        }
    }

    const result: DeviceSyncResult = {
        synced: 0,
        unchanged: unchanged.length,
        excluded: plan.excluded.length,
        skippedConflicts: [],
        failed: [],
    };

    for (const listing of toSync) {
        try {
            const deviceFile = deviceFiles.find((f) => f.uri === listing.uri);
            if (!deviceFile) continue; // Listing changed between the scan and here; pick it up next run.

            const vaultPath = deviceUriToVaultPath(
                settings.syncFolder,
                listing.uri,
                deviceFile.name,
                deviceFile.directoryNames,
            );

            const response = await fetchFromDevice(ip, listing.uri, `Failed to download ${deviceFile.name}`, {
                timeoutMs: DEVICE_TRANSFER_TIMEOUT_MS,
                pathLeafName: deviceFile.name,
                pathDirectoryNames: deviceFile.directoryNames,
            });
            if (!response.ok) {
                throw new Error(`Supernote responded with status ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            const newHash = hashBytes(new Uint8Array(buffer));

            const decision = decideWrite(await currentHash(app, vaultPath), settings.noteSyncState[listing.uri], newHash);

            if (decision === 'skip-conflict') {
                result.skippedConflicts.push(vaultPath);
                continue;
            }

            const parentFolder = vaultPath.includes('/') ? vaultPath.slice(0, vaultPath.lastIndexOf('/')) : '';
            await ensureFolder(app, parentFolder);
            await writeBinaryAt(app, vaultPath, buffer);

            settings.noteSyncState[listing.uri] = buildSyncRecord(listing, vaultPath, newHash);
            result.synced++;
        } catch (err) {
            result.failed.push({ file: listing.uri, error: err instanceof Error ? err.message : String(err) });
        }
    }

    // The loop above only ever looks at toSync — files the *device*
    // reports as new or changed. A file the user edited locally (in the
    // vault, or directly on disk) whose device counterpart hasn't changed
    // would otherwise go completely unnoticed: nothing threatens to
    // overwrite it, but nothing flags the drift either, until the device
    // copy eventually changes too and the file re-enters toSync. Since
    // this only reads vault-local files (no device/network round-trip — the
    // actual cost planSync's change detection avoids), it's cheap enough to
    // check on every run rather than waiting for that.
    for (const listing of unchanged) {
        const record = settings.noteSyncState[listing.uri];
        if (!record) continue; // 'unchanged' implies a record exists; defensive only.

        try {
            // currentHash() returning null here just means "safe to create" as
            // far as decideWrite() is concerned — never 'skip-conflict' — which
            // correctly treats a since-deleted vault copy as a different
            // problem than a content edit, without needing a separate check.
            if (decideWrite(await currentHash(app, record.vaultPath), record) === 'skip-conflict') {
                result.skippedConflicts.push(record.vaultPath);
            }
        } catch (err) {
            console.error(`Failed to check ${record.vaultPath} for local edits:`, err);
        }
    }

    await saveSettings();

    return result;
}
