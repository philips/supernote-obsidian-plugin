import { App, TFile } from 'obsidian';
import { SupernotePluginSettings } from './settings';
import { scanDeviceSupernoteTree } from './FileListModal';
import { fetchFromDevice, DEVICE_TRANSFER_TIMEOUT_MS } from './deviceFetch';
import {
    DeviceNoteListing,
    planSync,
    deviceUriToVaultPath,
    decideWrite,
    buildSyncRecord,
    parsePathFilters,
    syncLogPath,
    formatSyncLogEntry,
    hashBytes,
} from './deviceSync';

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

// Creates "Sync Log.md" (see deviceSync.ts) with just a heading if it
// doesn't exist yet, otherwise returns the existing file untouched — called
// unconditionally at the end of every sync run (see runDeviceSync) so the
// file is discoverable right after the first sync, even a clean one with
// nothing to actually log.
async function ensureSyncLogFile(app: App, syncFolder: string): Promise<TFile> {
    const logPath = syncLogPath(syncFolder);
    const parentFolder = logPath.includes('/') ? logPath.slice(0, logPath.lastIndexOf('/')) : '';
    await ensureFolder(app, parentFolder);

    const existing = app.vault.getAbstractFileByPath(logPath);
    if (existing instanceof TFile) return existing;
    return app.vault.create(logPath, '');
}

// Appends one pre-formatted entry to "Sync Log.md". Uses Vault.append rather
// than read-modify-write so this can't clobber anything a user has since
// added to the log themselves, and so two sync runs racing can't stomp on
// each other's entries.
export async function appendSyncLogEntry(app: App, syncFolder: string, entry: string): Promise<void> {
    const file = await ensureSyncLogFile(app, syncFolder);
    await app.vault.append(file, entry);
}

export interface DeviceSyncResult {
    synced: number;
    unchanged: number;
    excluded: number;
    skippedConflicts: string[];
    failed: { file: string; error: string }[];
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

    const deviceFiles = await scanDeviceSupernoteTree(ip);
    const listings: DeviceNoteListing[] = deviceFiles.map((f) => ({ uri: f.uri, date: f.date, size: f.size }));
    const patterns = parsePathFilters(settings.syncPathFiltersRaw);
    const plan = planSync(listings, settings.noteSyncState, patterns);

    const result: DeviceSyncResult = {
        synced: 0,
        unchanged: plan.unchanged.length,
        excluded: plan.excluded.length,
        skippedConflicts: [],
        failed: [],
    };

    for (const listing of plan.toSync) {
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

    // The loop above only ever looks at plan.toSync — files the *device*
    // reports as new or changed. A file the user edited locally (in the
    // vault, or directly on disk) whose device counterpart hasn't changed
    // would otherwise go completely unnoticed: nothing threatens to
    // overwrite it, but nothing flags the drift either, until the device
    // copy eventually changes too and the file re-enters plan.toSync. Since
    // this only reads vault-local files (no device/network round-trip — the
    // actual cost planSync's change detection avoids), it's cheap enough to
    // check on every run rather than waiting for that.
    for (const listing of plan.unchanged) {
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

    const logEntry = formatSyncLogEntry(result);
    if (logEntry) {
        await appendSyncLogEntry(app, settings.syncFolder, logEntry);
    } else {
        // Nothing worth logging this run, but still make sure the log file
        // itself exists — otherwise a run (or several) with nothing to
        // report leaves no trace that sync ever ran at all.
        await ensureSyncLogFile(app, settings.syncFolder);
    }

    return result;
}
