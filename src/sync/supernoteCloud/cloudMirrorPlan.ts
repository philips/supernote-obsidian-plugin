import { matchesAnyPathPattern, matchesFileExtension, FileExtensionAllowlist } from '../syncFilters';
import { CloudInventoryItem, CloudInventoryPass } from './cloudInventory';
import { MIRROR_METADATA_DIRECTORY } from '../sharedMirrorManifest';

// A Cloud listing's parent-derived path is intentionally insufficient here;
// this value must come from the separately verified path-query boundary.
export interface VerifiedCloudFile {
    item: CloudInventoryItem;
    canonicalPath: string;
}

export function bindVerifiedCloudPaths(
    inventory: CloudInventoryPass,
    canonicalPathsById: Readonly<Record<string, string>>,
): VerifiedCloudFile[] {
    // Bind by opaque ID, not filename: duplicate names are valid in different
    // directories, while a missing query result must stop planning altogether.
    const seen = new Set<string>();
    return inventory.items.filter((item) => !item.isFolder).map((item) => {
        if (seen.has(item.id)) throw new Error('Cloud inventory contains duplicate file IDs');
        seen.add(item.id);
        const canonicalPath = Object.hasOwn(canonicalPathsById, item.id) ? canonicalPathsById[item.id] : undefined;
        if (!canonicalPath) throw new Error('Missing verified Cloud file path');
        return { item, canonicalPath };
    });
}

export interface CloudMirrorRecord {
    contentHash: string;
    cloudMd5?: string;
}

export interface CloudMirrorCandidate extends VerifiedCloudFile {
    vaultPath: string;
}

export interface CloudMirrorPlan {
    toDownload: CloudMirrorCandidate[];
    unchanged: CloudMirrorCandidate[];
    excluded: VerifiedCloudFile[];
    protected: CloudMirrorCandidate[];
    missingChecksum: CloudMirrorCandidate[];
}

export function missingManagedCloudPaths(
    files: VerifiedCloudFile[],
    syncFolder: string,
    records: Readonly<Record<string, CloudMirrorRecord>>,
    pathFilters: readonly string[],
    fileExtensions: FileExtensionAllowlist,
): string[] {
    const root = syncFolder.replace(/^\/+|\/+$/g, '');
    const present = new Set(files.map((file) => `${root}${file.canonicalPath}`));
    return Object.keys(records).filter((path) => {
        if (!path.startsWith(`${root}/`) || present.has(path)) return false;
        const relative = path.slice(root.length);
        return relative.toLowerCase() !== '/sync log.md'
            && !relative.toLowerCase().startsWith(`/${MIRROR_METADATA_DIRECTORY}/`)
            && matchesAnyPathPattern([relative], pathFilters)
            && matchesFileExtension(relative.split('/').at(-1)!, fileExtensions);
    });
}

export function planCloudMirror(
    files: VerifiedCloudFile[],
    syncFolder: string,
    manifest: Readonly<Record<string, CloudMirrorRecord>>,
    localHashes: Readonly<Record<string, string | null>>,
    pathFilters: readonly string[],
    fileExtensions: FileExtensionAllowlist,
): CloudMirrorPlan {
    // This is planning only. Absence from this inventory is not a delete signal;
    // deletion requires the separate complete, stable two-pass gate.
    const plan: CloudMirrorPlan = { toDownload: [], unchanged: [], excluded: [], protected: [], missingChecksum: [] };
    const destinations = new Set<string>();
    const root = syncFolder.replace(/^\/+|\/+$/g, '');
    if (!root || root.split('/').some((segment) => !isSafeSegment(segment))) {
        throw new Error('Unsafe Cloud sync destination root');
    }

    for (const file of files) {
        if (file.item.isFolder) continue;
        const segments = file.canonicalPath.split('/');
        if (segments[0] !== '' || segments.length < 2 || segments.slice(1).some((segment) => !isSafeSegment(segment))) {
            throw new Error('Unsafe verified Cloud path');
        }
        if (segments[1].toLowerCase() === MIRROR_METADATA_DIRECTORY) {
            throw new Error('Cloud path collides with reserved mirror metadata');
        }
        if (segments.length === 2 && segments[1].toLowerCase() === 'sync log.md') {
            throw new Error('Cloud path collides with reserved sync log');
        }
        const vaultPath = `${root}/${segments.slice(1).join('/')}`;
        if (destinations.has(vaultPath)) throw new Error('Cloud inventory contains colliding paths');
        destinations.add(vaultPath);

        if (!matchesAnyPathPattern([file.canonicalPath], pathFilters)
            || !matchesFileExtension(segments.at(-1)!, fileExtensions)) {
            plan.excluded.push(file);
            continue;
        }
        const candidate = { ...file, vaultPath };
        // Only a valid Cloud checksum can support the no-download fast path.
        // Missing metadata is reported separately instead of guessed from size/date.
        if (!file.item.md5 || !/^[a-f\d]{32}$/i.test(file.item.md5)) {
            plan.missingChecksum.push(candidate);
            continue;
        }
        const record = manifest[vaultPath];
        const localHash = localHashes[vaultPath] ?? null;
        // Protect edits before considering remote equality: an unchanged server
        // checksum does not make a locally modified mirror safe to adopt.
        if (localHash !== null && record && localHash !== record.contentHash) {
            plan.protected.push(candidate);
        } else if (record?.cloudMd5 && file.item.md5 === record.cloudMd5 && localHash !== null) {
            plan.unchanged.push(candidate);
        } else {
            plan.toDownload.push(candidate);
        }
    }
    return plan;
}

function isSafeSegment(segment: string): boolean {
    return segment.length > 0 && segment !== '.' && segment !== '..'
    && !/[\\:*?"<>|]/.test(segment)
    && ![...segment].some((character) => character.charCodeAt(0) < 32)
    && !segment.endsWith('.') && !segment.endsWith(' ');
}