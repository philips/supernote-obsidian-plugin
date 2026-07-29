// Pure planning/decision logic for mirroring .note/.spd files from a
// Supernote device (over "Browse and Access") into the vault, unmodified —
// see issue #119. Sync only ever copies the raw file; it never converts it
// to markdown/images/PDF (that's a separate, one-off "import" flow — see
// ImportTodayModal/buildInsertableContent — which doesn't have to deal with
// re-syncing or overwrite conflicts the way something that runs repeatedly
// does). Deliberately has no dependency on Obsidian's API: everything here
// operates on plain data (device listings, a persisted manifest, byte
// hashes) so the efficiency (skip-what-hasn't-changed) and safety (never
// overwrite content we didn't write) rules can be unit tested directly,
// without mocking App/Vault. The Obsidian-facing orchestration that calls
// these lives in syncEngine.ts.

/** Minimal shape of a device file needed for change detection — a subset of FileListModal's SupernoteFile. */
export interface DeviceNoteListing {
    uri: string;
    date: string;
    size: number;
}

/** One entry in the persisted sync manifest: what we last wrote for a given device note. */
export interface SyncedNoteRecord {
    deviceUri: string;
    deviceDate: string;
    deviceSize: number;
    vaultPath: string;
    contentHash: string;
    lastSyncedAt: string;
}

export type SyncManifest = Record<string, SyncedNoteRecord>;

// ---------------------------------------------------------------------------
// Path scoping (which device notes are in-bounds for sync)
// ---------------------------------------------------------------------------

// Translates a small glob subset into an anchored RegExp: `*` matches any run
// of characters except `/`, `**` matches any run of characters including `/`,
// `?` matches a single character, everything else is literal. Deliberately
// minimal (no brace expansion, no character classes, no dependency) — device
// paths only need coarse folder/extension scoping, not full shell-glob
// semantics.
export function globToRegExp(pattern: string): RegExp {
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === '*') {
            if (pattern[i + 1] === '*') {
                re += '.*';
                i++;
            } else {
                re += '[^/]*';
            }
        } else if (c === '?') {
            re += '[^/]';
        } else if ('.+^${}()|[]\\'.includes(c)) {
            re += '\\' + c;
        } else {
            re += c;
        }
    }
    return new RegExp(`^${re}$`);
}

// No patterns configured means "sync everything the device has" — scoping
// down further is opt-in, since the sync run itself (manual command, or the
// auto-sync toggle) is already the opt-in step. Patterns match against the
// full device URI (leading slash included, matching what fetchSupernoteDirectory
// returns).
export function matchesAnyPattern(deviceUri: string, patterns: string[]): boolean {
    if (patterns.length === 0) return true;
    return patterns.some((p) => globToRegExp(p).test(deviceUri));
}

// Settings store path filters as one text field (newline- or comma-separated)
// since the declarative settings API's text control works on a single string,
// not a list.
export function parsePathFilters(raw: string): string[] {
    return raw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Change detection (efficiency: never re-fetch/re-render what hasn't moved)
// ---------------------------------------------------------------------------

export type ChangeStatus = 'new' | 'changed' | 'unchanged';

// The device's directory listing (name/date/size) is cheap — a single HTTP
// request lists a whole folder — so change detection is driven entirely by
// comparing that listing against the manifest's last-seen date+size. Neither
// alone is reliable in principle (a listing could return the same size for
// different content), but combined they're enough to avoid the *expensive*
// part (downloading the file) for the common case of nothing having changed,
// without ever downloading a file speculatively just to check.
export function classifyChange(file: DeviceNoteListing, manifest: SyncManifest): ChangeStatus {
    const record = manifest[file.uri];
    if (!record) return 'new';
    if (record.deviceDate !== file.date || record.deviceSize !== file.size) return 'changed';
    return 'unchanged';
}

export interface SyncPlan {
    /** New or changed files that need downloading (and mirroring into the vault). */
    toSync: DeviceNoteListing[];
    /** Matched the configured scope but nothing has changed since last sync. */
    unchanged: DeviceNoteListing[];
    /** Didn't match the configured path filters — out of scope entirely. */
    excluded: DeviceNoteListing[];
}

// Combines scoping + change detection into the single decision "does this
// device file need work this run". Never returns a delete/remove action —
// device-side deletions or renames are explicitly out of scope (see issue
// #119 discussion): a sync run only ever adds or updates vault content, so a
// bug here can't destroy something the device no longer has.
export function planSync(files: DeviceNoteListing[], manifest: SyncManifest, pathFilters: string[]): SyncPlan {
    const toSync: DeviceNoteListing[] = [];
    const unchanged: DeviceNoteListing[] = [];
    const excluded: DeviceNoteListing[] = [];

    for (const file of files) {
        if (!matchesAnyPattern(file.uri, pathFilters)) {
            excluded.push(file);
            continue;
        }
        if (classifyChange(file, manifest) === 'unchanged') {
            unchanged.push(file);
        } else {
            toSync.push(file);
        }
    }

    return { toSync, unchanged, excluded };
}

// ---------------------------------------------------------------------------
// Deterministic vault paths (safety: re-syncing updates the same file
// instead of piling up "Note 2.md"-style duplicates)
// ---------------------------------------------------------------------------

const INVALID_FILENAME_CHARS = /[\\:*?"<>|]/g;

// Maps a device note to a stable vault path that mirrors the device's own
// folder structure and filename (extension included — sync only ever copies
// the raw .note file, never converts it) under the configured sync root, so
// re-syncing the same note always resolves to the same vault file.
// (VaultWriter's existing writeMarkdownFile instead uniquifies on every
// write — appropriate for a one-off manual "attach", wrong for something
// that runs repeatedly.)
export function deviceUriToVaultPath(syncFolder: string, deviceUri: string): string {
    const segments = deviceUri
        .split('/')
        .filter((s) => s.length > 0)
        .map((s) => s.replace(INVALID_FILENAME_CHARS, '_'));

    const cleanRoot = syncFolder.replace(/^\/+|\/+$/g, '');
    return cleanRoot ? `${cleanRoot}/${segments.join('/')}` : segments.join('/');
}

// ---------------------------------------------------------------------------
// Content fingerprint + overwrite guard (safety: never silently discard a
// user's local edits to a previously-synced note)
// ---------------------------------------------------------------------------

// A fast, deterministic, *non-cryptographic* fingerprint of a synced .note
// file's raw bytes, used only to answer "does this vault file still hold
// exactly what we last wrote there" — not a security boundary, so ordinary
// hash-quality collision resistance is overkill. Kept synchronous (unlike
// crypto.subtle.digest) so the overwrite-safety check below stays a plain
// function, and dependency-free so it behaves identically on desktop,
// mobile, and under vitest.
export function hashBytes(bytes: Uint8Array): string {
    let h1 = 0x811c9dc5;
    let h2 = (0x1000193 ^ bytes.length) >>> 0;
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        h1 = Math.imul(h1 ^ b, 0x01000193);
        h2 = Math.imul(h2 ^ b, 0x85ebca6b);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export type WriteDecision = 'create' | 'overwrite' | 'skip-conflict';

// The core overwrite-safety rule: a synced file is only ever overwritten if
// it's still exactly what the plugin itself last wrote there. Takes an
// already-computed hash (from hashBytes()) rather than the content itself,
// so the caller controls exactly when the (only mildly expensive) hashing
// happens.
//   - No file at that path yet -> safe to create.
//   - A file exists but we have no manifest record of writing it (e.g. sync
//     history was "forgotten", or this collides with a pre-existing file
//     never written by sync) -> if the caller can tell us what it's about to
//     write (`incomingContentHash`, from a fresh download — the "unchanged"
//     drift check below doesn't have this, since it deliberately avoids
//     downloading anything) and it's already byte-identical to what's
//     there, there's nothing to protect: recognize this as already in sync
//     rather than treating every un-recorded file as an unowned collision.
//     Otherwise, stay conservative and refuse.
//   - A file exists and we do have a record, but its hash no longer matches
//     what we recorded at last write -> the user edited the mirrored .note
//     file directly since. Skip rather than clobber their edit.
//   - Otherwise the file is untouched since our last write -> safe to
//     re-mirror.
export function decideWrite(
    existingContentHash: string | null,
    record: SyncedNoteRecord | undefined,
    incomingContentHash?: string,
): WriteDecision {
    if (existingContentHash === null) return 'create';
    if (!record) {
        return incomingContentHash !== undefined && existingContentHash === incomingContentHash
            ? 'overwrite'
            : 'skip-conflict';
    }
    return existingContentHash === record.contentHash ? 'overwrite' : 'skip-conflict';
}

export function buildSyncRecord(
    file: DeviceNoteListing,
    vaultPath: string,
    contentHash: string,
    now: Date = new Date(),
): SyncedNoteRecord {
    return {
        deviceUri: file.uri,
        deviceDate: file.date,
        deviceSize: file.size,
        vaultPath,
        contentHash,
        lastSyncedAt: now.toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Sync log ("Sync Log.md"): a human-readable, append-only record of the
// noteworthy events from each sync run — conflicts and failures, not routine
// "N synced, M unchanged" runs — so those don't only ever flash by in a
// Notice. Lives inside the sync folder itself, keeping it inside the same
// confined-blast-radius guarantee as everything else auto-sync writes.
// ---------------------------------------------------------------------------

export function syncLogPath(syncFolder: string): string {
    const cleanRoot = syncFolder.replace(/^\/+|\/+$/g, '');
    return cleanRoot ? `${cleanRoot}/Sync Log.md` : 'Sync Log.md';
}

function renderLogEntry(now: Date, lines: string[]): string {
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    return `## ${timestamp}\n${lines.map((l) => `- ${l}`).join('\n')}\n\n`;
}

export interface SyncLogInput {
    skippedConflicts: string[];
    failed: { file: string; error: string }[];
}

// Formats one sync run's conflicts/failures as a log entry, or null if there
// weren't any — a clean run doesn't get an entry, so the log stays a record
// of things that actually needed attention rather than routine noise.
export function formatSyncLogEntry(result: SyncLogInput, now: Date = new Date()): string | null {
    if (result.skippedConflicts.length === 0 && result.failed.length === 0) return null;

    return renderLogEntry(now, [
        ...result.skippedConflicts.map((path) => `Skipped (edited locally since last sync): \`${path}\``),
        ...result.failed.map((f) => `Failed: \`${f.file}\` — ${f.error}`),
    ]);
}

// Same idea, for a sync run that failed outright before it could produce a
// per-file result at all (e.g. the device was unreachable).
export function formatSyncFailureLogEntry(message: string, now: Date = new Date()): string {
    return renderLogEntry(now, [`Sync failed: ${message}`]);
}
