import { hashBytes, SyncManifest } from '../deviceSync';
import { fromIpSyncManifest, MIRROR_METADATA_DIRECTORY, SharedMirrorManifest } from './sharedMirrorManifest';

export type MirrorManifestSlot = 'primary' | 'backup';

export interface MirrorManifestStorage {
    read(slot: MirrorManifestSlot): Promise<string | null>;
    write(slot: MirrorManifestSlot, contents: string): Promise<void>;
}

interface StoredManifest {
    revision: number;
    manifest: SharedMirrorManifest;
    checksum: string;
}

export interface LoadedMirrorManifest {
    manifest: SharedMirrorManifest;
    revision: number;
    slot: MirrorManifestSlot;
}

const slots: MirrorManifestSlot[] = ['primary', 'backup'];

// This detects accidental truncation/corruption, not malicious modification;
// account binding and vault-local ownership hashes provide separate safeguards.
function checksum(revision: number, manifest: SharedMirrorManifest): string {
    return hashBytes(new TextEncoder().encode(JSON.stringify({ revision, manifest })));
}

function validManifest(value: unknown): value is SharedMirrorManifest {
    if (!value || typeof value !== 'object') return false;
    const manifest = value as Partial<SharedMirrorManifest>;
    if (manifest.version !== 1 || !manifest.records || typeof manifest.records !== 'object'
        || Array.isArray(manifest.records)
        || (manifest.cloudAccountFingerprint !== null
            && (typeof manifest.cloudAccountFingerprint !== 'string' || !manifest.cloudAccountFingerprint))) {
        return false;
    }
    return Object.entries(manifest.records).every(([path, entry]) => {
        if (!path || path.startsWith('/') || path.split('/').some((segment) => !segment || segment === '.'
            || segment === '..' || segment === MIRROR_METADATA_DIRECTORY || /[\\:*?"<>|]/.test(segment)
            || segment.endsWith('.') || segment.endsWith(' ')
            || [...segment].some((character) => character.charCodeAt(0) < 32))
            || !entry || typeof entry !== 'object' || typeof entry.contentHash !== 'string'
            || !entry.contentHash || !entry.source || typeof entry.source !== 'object') return false;
        const source = entry.source;
        return source.engineId === 'ip-device'
            ? typeof source.deviceUri === 'string' && source.deviceUri.startsWith('/')
                && typeof source.deviceDate === 'string' && Number.isSafeInteger(source.deviceSize)
                && source.deviceSize >= 0
            : source.engineId === 'supernote-cloud' && typeof source.md5 === 'string'
                && /^[a-f\d]{32}$/i.test(source.md5);
    });
}

function decode(contents: string): StoredManifest | null {
    try {
        const value: unknown = JSON.parse(contents);
        if (!value || typeof value !== 'object') return null;
        const entry = value as Partial<StoredManifest>;
        if (!Number.isSafeInteger(entry.revision) || (entry.revision ?? 0) < 1
            || !validManifest(entry.manifest)
            || typeof entry.checksum !== 'string'
            || entry.checksum !== checksum(entry.revision!, entry.manifest)) return null;
        return entry as StoredManifest;
    } catch {
        return null;
    }
}

async function readLatest(storage: MirrorManifestStorage): Promise<LoadedMirrorManifest | null> {
    // Keep the prior slot intact while a new revision is written to the other.
    // If the only present copy is invalid, fail closed instead of silently
    // re-importing stale legacy settings as though this were a new vault.
    const contents = await Promise.all(slots.map((slot) => storage.read(slot)));
    const valid = contents.flatMap((text, index): LoadedMirrorManifest[] => {
        const entry = text === null ? null : decode(text);
        return entry ? [{ manifest: entry.manifest, revision: entry.revision, slot: slots[index] }] : [];
    });
    if (valid.length === 0 && contents.some((text) => text !== null)) {
        throw new Error('Shared mirror manifest exists but neither copy is valid');
    }
    if (valid.length === 2 && valid[0].revision === valid[1].revision
        && JSON.stringify(valid[0].manifest) !== JSON.stringify(valid[1].manifest)) {
        throw new Error('Shared mirror manifest copies disagree at the same revision');
    }
    return valid.sort((left, right) => right.revision - left.revision)[0] ?? null;
}

export async function loadMirrorManifest(
    storage: MirrorManifestStorage,
    legacy: SyncManifest,
): Promise<LoadedMirrorManifest> {
    // Legacy settings remain untouched during migration; removal belongs to a
    // later engine integration once its new manifest commit is durable.
    const current = await readLatest(storage);
    if (current) return current;
    return saveMirrorManifest(storage, null, fromIpSyncManifest(legacy));
}

export async function saveMirrorManifest(
    storage: MirrorManifestStorage,
    previous: LoadedMirrorManifest | null,
    manifest: SharedMirrorManifest,
): Promise<LoadedMirrorManifest> {
    // Compare the caller's snapshot with storage before writing so two sync
    // paths cannot silently overwrite a newer manifest revision.
    if (!validManifest(manifest)) throw new Error('Invalid shared mirror manifest');
    const current = await readLatest(storage);
    if (current?.revision !== (previous?.revision ?? undefined)
        || current?.slot !== (previous?.slot ?? undefined)
        || (current && previous && JSON.stringify(current.manifest) !== JSON.stringify(previous.manifest))) {
        throw new Error('Shared mirror manifest changed since it was loaded');
    }
    const revision = (current?.revision ?? 0) + 1;
    const slot = current?.slot === 'primary' ? 'backup' : 'primary';
    const contents = JSON.stringify({ revision, manifest, checksum: checksum(revision, manifest) });
    await storage.write(slot, contents);
    const verified = decode(await storage.read(slot) ?? '');
    if (!verified || verified.revision !== revision || JSON.stringify(verified.manifest) !== JSON.stringify(manifest)) {
        throw new Error('Shared mirror manifest write could not be verified');
    }
    return { manifest, revision, slot };
}