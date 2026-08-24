import { describe, it, expect } from 'vitest';
import {
    globToRegExp,
    matchesAnyPattern,
    parsePathFilters,
    classifyChange,
    planSync,
    deviceUriToVaultPath,
    hashBytes,
    decideWrite,
    buildSyncRecord,
    syncLogPath,
    formatSyncLogEntry,
    formatSyncFailureLogEntry,
    DeviceNoteListing,
    SyncManifest,
    SyncedNoteRecord,
} from './deviceSync';

function bytesOf(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

function listing(overrides: Partial<DeviceNoteListing> = {}): DeviceNoteListing {
    return { uri: '/Note/foo.note', date: '2026-07-25 10:33:04', size: 1000, ...overrides };
}

function record(overrides: Partial<SyncedNoteRecord> = {}): SyncedNoteRecord {
    return {
        deviceUri: '/Note/foo.note',
        deviceDate: '2026-07-25 10:33:04',
        deviceSize: 1000,
        vaultPath: 'Supernote sync/Note/foo.note',
        contentHash: hashBytes(bytesOf('hello')),
        lastSyncedAt: '2026-07-25T10:33:04.000Z',
        ...overrides,
    };
}

describe('globToRegExp / matchesAnyPattern', () => {
    it('matches a literal path exactly', () => {
        expect(globToRegExp('/Note/foo.note').test('/Note/foo.note')).toBe(true);
        expect(globToRegExp('/Note/foo.note').test('/Note/bar.note')).toBe(false);
    });

    it('does not match a partial/unanchored substring', () => {
        expect(globToRegExp('foo.note').test('/Note/foo.note')).toBe(false);
    });

    it('* matches within a single path segment but not across /', () => {
        const re = globToRegExp('/Diary/*.note');
        expect(re.test('/Diary/2026-07-25.note')).toBe(true);
        expect(re.test('/Diary/Sub/2026-07-25.note')).toBe(false);
    });

    it('** matches across directory boundaries', () => {
        const re = globToRegExp('/Diary/**');
        expect(re.test('/Diary/2026-07-25.note')).toBe(true);
        expect(re.test('/Diary/Sub/Folder/2026-07-25.note')).toBe(true);
        expect(re.test('/Work/2026-07-25.note')).toBe(false);
    });

    it('? matches exactly one character', () => {
        const re = globToRegExp('/Note/day?.note');
        expect(re.test('/Note/day1.note')).toBe(true);
        expect(re.test('/Note/day12.note')).toBe(false);
    });

    it('escapes regex metacharacters in the literal portions', () => {
        const re = globToRegExp('/Note/a+b(1).note');
        expect(re.test('/Note/a+b(1).note')).toBe(true);
        expect(re.test('/Note/aXb1.note')).toBe(false);
    });

    it('matchesAnyPattern treats an empty pattern list as "match everything"', () => {
        expect(matchesAnyPattern('/Anything/at/all.note', [])).toBe(true);
    });

    it('matchesAnyPattern is true if any one pattern matches', () => {
        const patterns = ['/Work/**', '/Diary/**'];
        expect(matchesAnyPattern('/Diary/today.note', patterns)).toBe(true);
        expect(matchesAnyPattern('/Personal/today.note', patterns)).toBe(false);
    });
});

describe('parsePathFilters', () => {
    it('splits on newlines and commas, trimming whitespace', () => {
        expect(parsePathFilters('/Diary/**, /Work/**\n/Personal/**')).toEqual([
            '/Diary/**',
            '/Work/**',
            '/Personal/**',
        ]);
    });

    it('drops empty entries from trailing separators or blank lines', () => {
        expect(parsePathFilters('/Diary/**,\n\n, /Work/**,')).toEqual(['/Diary/**', '/Work/**']);
    });

    it('returns an empty array for blank input', () => {
        expect(parsePathFilters('')).toEqual([]);
        expect(parsePathFilters('   \n  ')).toEqual([]);
    });
});

describe('classifyChange', () => {
    it('is "new" when there is no manifest record for the device URI', () => {
        expect(classifyChange(listing(), {})).toBe('new');
    });

    it('is "unchanged" when date and size both match the manifest record', () => {
        const manifest: SyncManifest = { '/Note/foo.note': record() };
        expect(classifyChange(listing(), manifest)).toBe('unchanged');
    });

    it('is "changed" when the date differs but size matches', () => {
        const manifest: SyncManifest = { '/Note/foo.note': record({ deviceDate: '2026-07-24 09:00:00' }) };
        expect(classifyChange(listing(), manifest)).toBe('changed');
    });

    it('is "changed" when the size differs but date matches', () => {
        const manifest: SyncManifest = { '/Note/foo.note': record({ deviceSize: 999 }) };
        expect(classifyChange(listing(), manifest)).toBe('changed');
    });

    it('is "changed" when both date and size differ', () => {
        const manifest: SyncManifest = {
            '/Note/foo.note': record({ deviceDate: '2020-01-01 00:00:00', deviceSize: 1 }),
        };
        expect(classifyChange(listing(), manifest)).toBe('changed');
    });

    it('keys strictly off the device URI, not just size/date coincidence', () => {
        const manifest: SyncManifest = { '/Note/other.note': record({ deviceUri: '/Note/other.note' }) };
        expect(classifyChange(listing(), manifest)).toBe('new');
    });
});

describe('planSync (efficiency: skip unchanged, respect scope, never propose deletes)', () => {
    it('puts a never-before-seen file in toSync', () => {
        const plan = planSync([listing()], {}, []);
        expect(plan.toSync).toEqual([listing()]);
        expect(plan.unchanged).toEqual([]);
        expect(plan.excluded).toEqual([]);
    });

    it('skips a file whose date and size are unchanged from the manifest — no re-download proposed', () => {
        const manifest: SyncManifest = { '/Note/foo.note': record() };
        const plan = planSync([listing()], manifest, []);
        expect(plan.toSync).toEqual([]);
        expect(plan.unchanged).toEqual([listing()]);
    });

    it('re-proposes a file whose device date/size moved on from the manifest', () => {
        const manifest: SyncManifest = { '/Note/foo.note': record({ deviceSize: 1 }) };
        const plan = planSync([listing()], manifest, []);
        expect(plan.toSync).toEqual([listing()]);
        expect(plan.unchanged).toEqual([]);
    });

    it('excludes files outside the configured path filters regardless of change state', () => {
        const changedButOutOfScope = listing({ uri: '/Work/foo.note' });
        const manifest: SyncManifest = {}; // "new" — would otherwise sync
        const plan = planSync([changedButOutOfScope], manifest, ['/Diary/**']);
        expect(plan.toSync).toEqual([]);
        expect(plan.excluded).toEqual([changedButOutOfScope]);
    });

    it('partitions a mixed batch into the three buckets correctly', () => {
        const inScopeNew = listing({ uri: '/Diary/new.note' });
        const inScopeUnchanged = listing({ uri: '/Diary/same.note' });
        const inScopeChanged = listing({ uri: '/Diary/changed.note', size: 2000 });
        const outOfScope = listing({ uri: '/Work/foo.note' });

        const manifest: SyncManifest = {
            '/Diary/same.note': record({ deviceUri: '/Diary/same.note' }),
            '/Diary/changed.note': record({ deviceUri: '/Diary/changed.note', deviceSize: 1 }),
        };

        const plan = planSync(
            [inScopeNew, inScopeUnchanged, inScopeChanged, outOfScope],
            manifest,
            ['/Diary/**'],
        );

        expect(plan.toSync).toEqual([inScopeNew, inScopeChanged]);
        expect(plan.unchanged).toEqual([inScopeUnchanged]);
        expect(plan.excluded).toEqual([outOfScope]);
    });

    it('never produces anything resembling a delete — files missing from the listing are simply absent from every bucket', () => {
        // Manifest remembers a file the device no longer reports (deleted/renamed
        // on-device). It must not show up anywhere in the plan, and in particular
        // must not appear in a bucket that would cause the vault copy to be removed.
        const manifest: SyncManifest = { '/Note/gone.note': record({ deviceUri: '/Note/gone.note' }) };
        const plan = planSync([listing()], manifest, []);

        const allBucketed = [...plan.toSync, ...plan.unchanged, ...plan.excluded].map((f) => f.uri);
        expect(allBucketed).not.toContain('/Note/gone.note');
        expect(plan).not.toHaveProperty('toDelete');
    });

    it('is a pure function of its inputs — the same call twice gives the same result', () => {
        const files = [listing({ uri: '/Diary/a.note' }), listing({ uri: '/Diary/b.note', size: 5 })];
        const manifest: SyncManifest = { '/Diary/a.note': record({ deviceUri: '/Diary/a.note' }) };
        expect(planSync(files, manifest, ['/Diary/**'])).toEqual(planSync(files, manifest, ['/Diary/**']));
    });
});

describe('deviceUriToVaultPath (safety: deterministic, collision-free naming — sync mirrors the raw .note file, so the extension is preserved, never converted)', () => {
    it('mirrors the device folder structure and filename, including the .note extension, under the sync root', () => {
        expect(deviceUriToVaultPath('Supernote sync', '/Diary/2026-07-25.note')).toBe(
            'Supernote sync/Diary/2026-07-25.note',
        );
    });

    it('preserves whatever extension the device file actually has, case and all', () => {
        expect(deviceUriToVaultPath('Sync', '/Diary/Page.NOTE')).toBe('Sync/Diary/Page.NOTE');
    });

    it('mirrors nested device subfolders as nested vault folders', () => {
        expect(deviceUriToVaultPath('Sync', '/A/B/C/note.note')).toBe('Sync/A/B/C/note.note');
    });

    it('sanitizes characters that are invalid in vault filenames', () => {
        expect(deviceUriToVaultPath('Sync', '/Note/weird:name*?.note')).toBe('Sync/Note/weird_name__.note');
    });

    it('decodes percent-encoded spaces in device URIs for vault filenames', () => {
        expect(deviceUriToVaultPath('Supernote sync', '/Note/Work%20Journal.note')).toBe(
            'Supernote sync/Note/Work Journal.note',
        );
    });

    it('prefers the listing name for the vault leaf when provided', () => {
        expect(deviceUriToVaultPath('Supernote sync', '/Note/Substack+Notes.note', 'Substack Notes.note')).toBe(
            'Supernote sync/Note/Substack Notes.note',
        );
    });

    it('does not produce a doubled or leading slash when the sync folder is empty', () => {
        const path = deviceUriToVaultPath('', '/Diary/2026-07-25.note');
        expect(path).toBe('Diary/2026-07-25.note');
        expect(path.startsWith('/')).toBe(false);
    });

    it('tolerates a sync folder with surrounding slashes', () => {
        expect(deviceUriToVaultPath('/Sync/', '/Diary/x.note')).toBe('Sync/Diary/x.note');
    });

    it('is deterministic: the same device URI always maps to the same vault path', () => {
        const a = deviceUriToVaultPath('Sync', '/Diary/x.note');
        const b = deviceUriToVaultPath('Sync', '/Diary/x.note');
        expect(a).toBe(b);
    });

    it('maps distinct device URIs to distinct vault paths (no accidental collision)', () => {
        const a = deviceUriToVaultPath('Sync', '/Diary/x.note');
        const b = deviceUriToVaultPath('Sync', '/Work/x.note');
        expect(a).not.toBe(b);
    });

    // Regression for GHSA-3gx3-r874-5pp4: a malicious/rogue device could send a
    // `uri` containing `..` segments to escape the sync folder (and the vault
    // entirely) on write, despite `name` alone passing the syncable-extension
    // filter upstream.
    it('strips ".." segments instead of letting them escape the sync folder', () => {
        expect(deviceUriToVaultPath('Supernote sync', '/../../PWNED.txt')).toBe(
            'Supernote sync/PWNED.txt',
        );
    });

    it('strips "." and ".." segments anywhere in the path, not just at the start', () => {
        expect(deviceUriToVaultPath('Sync', '/Diary/../../../etc/x.note')).toBe('Sync/Diary/etc/x.note');
        expect(deviceUriToVaultPath('Sync', '/Diary/./x.note')).toBe('Sync/Diary/x.note');
    });

    it('never produces a resolved path outside the sync folder for any ".."-laden input', () => {
        const path = deviceUriToVaultPath('Supernote sync', '/../../../../../../PWNED.txt');
        expect(path.startsWith('Supernote sync/')).toBe(true);
        expect(path).not.toContain('..');
    });
});

describe('hashBytes', () => {
    it('is deterministic for the same bytes', () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        expect(hashBytes(bytes)).toBe(hashBytes(new Uint8Array([1, 2, 3, 4])));
    });

    it('differs for different bytes', () => {
        expect(hashBytes(new Uint8Array([1, 2, 3]))).not.toBe(hashBytes(new Uint8Array([1, 2, 4])));
    });

    it('differs for byte arrays that differ only in length', () => {
        expect(hashBytes(new Uint8Array([]))).not.toBe(hashBytes(new Uint8Array([0])));
    });

    it('is sensitive to byte order', () => {
        expect(hashBytes(new Uint8Array([1, 2]))).not.toBe(hashBytes(new Uint8Array([2, 1])));
    });

    it('is sensitive to repeated-block content (not just a naive sum/xor)', () => {
        expect(hashBytes(bytesOf('aaaa'))).not.toBe(hashBytes(bytesOf('aa')));
        expect(hashBytes(bytesOf('abab'))).not.toBe(hashBytes(bytesOf('baba')));
    });

    it('detects a single byte appended to otherwise-identical content', () => {
        // This is exactly the shape of a hand-edit like `echo >> file.note`:
        // original bytes untouched, with something appended at the end.
        expect(hashBytes(bytesOf('original .note bytes'))).not.toBe(hashBytes(bytesOf('original .note bytesX')));
    });
});

describe('decideWrite (safety: never clobber a local edit or an unowned file)', () => {
    it('creates when nothing exists at the target path yet', () => {
        expect(decideWrite(null, undefined)).toBe('create');
    });

    it('overwrites when the existing hash still matches the recorded hash (untouched since our last write)', () => {
        const bytes = bytesOf('<note file bytes>');
        const rec = record({ contentHash: hashBytes(bytes) });
        expect(decideWrite(hashBytes(bytes), rec)).toBe('overwrite');
    });

    it('skips as a conflict when the existing hash no longer matches the recorded hash (content changed since)', () => {
        const rec = record({ contentHash: hashBytes(bytesOf('original bytes')) });
        expect(decideWrite(hashBytes(bytesOf('hand-edited bytes')), rec)).toBe('skip-conflict');
    });

    it('skips as a conflict when a file already exists at the path but we have no record of writing it', () => {
        // E.g. the deterministic path happened to collide with a pre-existing
        // user file, or the manifest was cleared independently of the vault.
        expect(decideWrite(hashBytes(bytesOf('some pre-existing unrelated content')), undefined)).toBe('skip-conflict');
    });

    it('treats a hash of empty content as real (falsy but present) content, not as "nothing exists"', () => {
        const rec = record({ contentHash: hashBytes(new Uint8Array()) });
        expect(decideWrite(hashBytes(new Uint8Array()), rec)).toBe('overwrite');
        expect(decideWrite(hashBytes(new Uint8Array()), undefined)).toBe('skip-conflict');
    });

    it('reproduces the reported bug scenario: appending to a synced .note file is detected and refused', () => {
        // `echo "adsfasdf" >> .../20260727_124828.note`
        const originalBytes = bytesOf('<note file bytes>');
        const rec = record({ contentHash: hashBytes(originalBytes) });

        const editedBytes = bytesOf('<note file bytes>adsfasdf\n');
        expect(decideWrite(hashBytes(editedBytes), rec)).toBe('skip-conflict');
        expect(decideWrite(hashBytes(originalBytes), rec)).toBe('overwrite');
    });

    describe('reconciling a missing record against freshly-downloaded content (incomingContentHash)', () => {
        it('reproduces the "Forget sync history" bug: a previously-synced, still-untouched file is recognized as already in sync rather than an unowned collision', () => {
            const bytes = bytesOf('<note file bytes, unchanged since it was last synced>');
            // No record — "Forget sync history" cleared it — but what's on
            // disk is exactly what the device has right now.
            expect(decideWrite(hashBytes(bytes), undefined, hashBytes(bytes))).toBe('overwrite');
        });

        it('still refuses when the existing file differs from the incoming content — could be a real foreign file, or a genuine local edit predating the forgotten record', () => {
            const existing = hashBytes(bytesOf('something else entirely'));
            const incoming = hashBytes(bytesOf('<note file bytes>'));
            expect(decideWrite(existing, undefined, incoming)).toBe('skip-conflict');
        });

        it('without an incoming hash to compare against, stays exactly as conservative as before (2-arg call sites are unaffected)', () => {
            expect(decideWrite(hashBytes(bytesOf('anything')), undefined)).toBe('skip-conflict');
        });

        it('is irrelevant once a record exists — a genuine local edit is still refused even if it happens to equal some unrelated "incoming" hash', () => {
            const rec = record({ contentHash: hashBytes(bytesOf('what we last wrote')) });
            const editedHash = hashBytes(bytesOf('hand-edited'));
            // incomingContentHash only ever matters in the !record branch.
            expect(decideWrite(editedHash, rec, editedHash)).toBe('skip-conflict');
        });
    });
});

describe('buildSyncRecord', () => {
    it('captures the device listing, vault path, and the given content hash', () => {
        const file = listing();
        const bytes = bytesOf('<note file bytes>');
        const now = new Date('2026-07-27T12:00:00.000Z');

        const rec = buildSyncRecord(file, 'Supernote sync/Note/foo.note', hashBytes(bytes), now);

        expect(rec).toEqual({
            deviceUri: file.uri,
            deviceDate: file.date,
            deviceSize: file.size,
            vaultPath: 'Supernote sync/Note/foo.note',
            contentHash: hashBytes(bytes),
            lastSyncedAt: now.toISOString(),
        });
    });

    it('round-trips through decideWrite as "overwrite" immediately after being built (nothing has diverged yet)', () => {
        const file = listing();
        const bytes = bytesOf('<note file bytes>');
        const rec = buildSyncRecord(file, 'Sync/foo.note', hashBytes(bytes));
        expect(decideWrite(hashBytes(bytes), rec)).toBe('overwrite');
    });

    it('defaults lastSyncedAt to "now" when no date is passed', () => {
        const before = Date.now();
        const rec = buildSyncRecord(listing(), 'Sync/foo.note', hashBytes(bytesOf('x')));
        const after = Date.now();
        const ts = new Date(rec.lastSyncedAt).getTime();
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
    });
});

describe('syncLogPath', () => {
    it('places the log inside the sync folder', () => {
        expect(syncLogPath('Supernote sync')).toBe('Supernote sync/Sync Log.md');
    });

    it('does not produce a leading slash when the sync folder is empty', () => {
        expect(syncLogPath('')).toBe('Sync Log.md');
    });

    it('tolerates a sync folder with surrounding slashes', () => {
        expect(syncLogPath('/Sync/')).toBe('Sync/Sync Log.md');
    });
});

describe('formatSyncLogEntry (only logs runs with something worth mentioning)', () => {
    const now = new Date('2026-07-27T11:15:32.000Z');

    it('returns null for a clean run with no conflicts or failures', () => {
        expect(formatSyncLogEntry({ skippedConflicts: [], failed: [] }, now)).toBeNull();
    });

    it('lists each skipped conflict on its own line under a timestamp heading', () => {
        const entry = formatSyncLogEntry(
            { skippedConflicts: ['Supernote sync/Diary/a.note', 'Supernote sync/Diary/b.note'], failed: [] },
            now,
        );
        expect(entry).toBe(
            '## 2026-07-27 11:15:32\n'
            + '- Skipped (edited locally since last sync): `Supernote sync/Diary/a.note`\n'
            + '- Skipped (edited locally since last sync): `Supernote sync/Diary/b.note`\n'
            + '\n',
        );
    });

    it('lists each failure with its error message', () => {
        const entry = formatSyncLogEntry(
            { skippedConflicts: [], failed: [{ file: '/Diary/broken.note', error: 'Supernote responded with status 500' }] },
            now,
        );
        expect(entry).toBe(
            '## 2026-07-27 11:15:32\n'
            + '- Failed: `/Diary/broken.note` — Supernote responded with status 500\n'
            + '\n',
        );
    });

    it('combines conflicts and failures in one entry, conflicts first', () => {
        const entry = formatSyncLogEntry(
            {
                skippedConflicts: ['Supernote sync/a.note'],
                failed: [{ file: '/b.note', error: 'timed out' }],
            },
            now,
        );
        expect(entry).toBe(
            '## 2026-07-27 11:15:32\n'
            + '- Skipped (edited locally since last sync): `Supernote sync/a.note`\n'
            + '- Failed: `/b.note` — timed out\n'
            + '\n',
        );
    });

    it('defaults to the current time when no date is passed', () => {
        const before = Date.now();
        const entry = formatSyncLogEntry({ skippedConflicts: ['x'], failed: [] });
        const after = Date.now();
        const heading = entry?.split('\n')[0] ?? '';
        const ts = new Date(heading.replace('## ', '').replace(' ', 'T') + 'Z').getTime();
        expect(ts).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
        expect(ts).toBeLessThanOrEqual(after);
    });
});

describe('formatSyncFailureLogEntry', () => {
    it('formats a single whole-run failure line under a timestamp heading', () => {
        const now = new Date('2026-07-27T11:15:32.000Z');
        expect(formatSyncFailureLogEntry('Supernote at 192.168.1.50 did not respond', now)).toBe(
            '## 2026-07-27 11:15:32\n'
            + '- Sync failed: Supernote at 192.168.1.50 did not respond\n'
            + '\n',
        );
    });
});

describe('end-to-end scenario: several sync runs in a row', () => {
    it('first run creates; unchanged run proposes nothing; edited-on-device run re-proposes and overwrites; locally-edited file is protected', () => {
        const manifest: SyncManifest = {};
        const deviceFiles: DeviceNoteListing[] = [listing({ uri: '/Diary/a.note' })];

        // Run 1: brand new file.
        let plan = planSync(deviceFiles, manifest, []);
        expect(plan.toSync.map((f) => f.uri)).toEqual(['/Diary/a.note']);

        const bytes1 = bytesOf('<note bytes v1>');
        expect(decideWrite(null, manifest[deviceFiles[0].uri])).toBe('create');
        manifest[deviceFiles[0].uri] = buildSyncRecord(deviceFiles[0], 'Sync/Diary/a.note', hashBytes(bytes1));

        // Run 2: nothing changed on the device.
        plan = planSync(deviceFiles, manifest, []);
        expect(plan.toSync).toEqual([]);
        expect(plan.unchanged.map((f) => f.uri)).toEqual(['/Diary/a.note']);

        // Run 3: device file changed (edited on the Supernote).
        const deviceFilesV2: DeviceNoteListing[] = [listing({ uri: '/Diary/a.note', date: '2026-07-26 08:00:00' })];
        plan = planSync(deviceFilesV2, manifest, []);
        expect(plan.toSync.map((f) => f.uri)).toEqual(['/Diary/a.note']);

        // Vault copy is still exactly what we wrote -> safe to overwrite.
        expect(decideWrite(hashBytes(bytes1), manifest[deviceFilesV2[0].uri])).toBe('overwrite');
        const bytes2 = bytesOf('<note bytes v2>');
        manifest[deviceFilesV2[0].uri] = buildSyncRecord(deviceFilesV2[0], 'Sync/Diary/a.note', hashBytes(bytes2));

        // Run 4: device unchanged again, but the user has since hand-edited the
        // mirrored .note file directly (e.g. `echo >> file.note`).
        plan = planSync(deviceFilesV2, manifest, []);
        expect(plan.unchanged.map((f) => f.uri)).toEqual(['/Diary/a.note']);
        // Even if something forced a rewrite attempt on an "unchanged" file, the
        // guard still protects local edits.
        expect(decideWrite(hashBytes(bytesOf('<note bytes v2>hand-edited')), manifest[deviceFilesV2[0].uri])).toBe('skip-conflict');
    });

    it('"Forget sync history" then resync: untouched files resume syncing instead of being skipped as unowned collisions', () => {
        const bytesA = bytesOf('<note bytes a>');
        const bytesB = bytesOf('<note bytes b>');
        let manifest: SyncManifest = {
            '/Note/a.note': buildSyncRecord(listing({ uri: '/Note/a.note' }), 'Sync/Note/a.note', hashBytes(bytesA)),
            '/Note/b.note': buildSyncRecord(listing({ uri: '/Note/b.note' }), 'Sync/Note/b.note', hashBytes(bytesB)),
        };
        const deviceFiles: DeviceNoteListing[] = [
            listing({ uri: '/Note/a.note' }),
            listing({ uri: '/Note/b.note' }),
        ];

        // "Forget sync history": the manifest is wiped, but nothing on disk
        // or on the device actually changed.
        manifest = {};
        const plan = planSync(deviceFiles, manifest, []);
        // With no records left, every device file looks "new" again — this
        // is the reported symptom: everything piles into toSync.
        expect(plan.toSync.map((f) => f.uri).sort()).toEqual(['/Note/a.note', '/Note/b.note']);

        // Each file's vault copy is still exactly what the device has —
        // decideWrite() must recognize that via the incoming hash from the
        // fresh download, not blanket-refuse every one as an unowned
        // collision just because the record is gone.
        expect(decideWrite(hashBytes(bytesA), manifest['/Note/a.note'], hashBytes(bytesA))).toBe('overwrite');
        expect(decideWrite(hashBytes(bytesB), manifest['/Note/b.note'], hashBytes(bytesB))).toBe('overwrite');
    });
});
