import { matchesAnyPathPattern, matchesFileExtension, FileExtensionAllowlist } from '../syncFilters';
import { CloudInventoryItem } from './cloudInventory';

export interface VerifiedCloudFile {
    item: CloudInventoryItem;
    canonicalPath: string;
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

export function planCloudMirror(
    files: VerifiedCloudFile[],
    syncFolder: string,
    manifest: Readonly<Record<string, CloudMirrorRecord>>,
    localHashes: Readonly<Record<string, string | null>>,
    pathFilters: readonly string[],
    fileExtensions: FileExtensionAllowlist,
): CloudMirrorPlan {
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
        const vaultPath = `${root}/${segments.slice(1).join('/')}`;
        if (destinations.has(vaultPath)) throw new Error('Cloud inventory contains colliding paths');
        destinations.add(vaultPath);

        if (!matchesAnyPathPattern([file.canonicalPath], pathFilters)
            || !matchesFileExtension(segments.at(-1)!, fileExtensions)) {
            plan.excluded.push(file);
            continue;
        }
        const candidate = { ...file, vaultPath };
        if (!file.item.md5 || !/^[a-f\d]{32}$/i.test(file.item.md5)) {
            plan.missingChecksum.push(candidate);
            continue;
        }
        const record = manifest[vaultPath];
        const localHash = localHashes[vaultPath] ?? null;
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