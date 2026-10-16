import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { SyncManifest } from './directIP/deviceSync';
import { CloudMirrorRecord } from './supernoteCloud/cloudMirrorPlan';

// Kept below the shared sync root so IP and Cloud reserve the same location;
// remote paths using this first segment must not shadow plugin metadata.
export const MIRROR_METADATA_DIRECTORY = '.supernote-sync';

export interface SharedMirrorRecord {
    contentHash: string;
    source: {
        engineId: 'ip-device';
        deviceUri: string;
        deviceDate: string;
        deviceSize: number;
    } | {
        engineId: 'supernote-cloud';
        md5: string;
    };
}

export interface PendingMirrorOperation {
    kind: 'write' | 'trash';
    root: string;
    path: string;
    beforeHash: string | null;
    after: SharedMirrorRecord | null;
}

export interface SharedMirrorManifest {
    version: 1;
    cloudAccountFingerprint: string | null;
    records: Record<string, SharedMirrorRecord>;
    pendingOperation?: PendingMirrorOperation;
    legacyHistoryRetired?: true;
    accountChange?: { targetFingerprint: string; pendingPath: string | null; protectedPaths: string[] };
}

export function cloudAccountFingerprint(userId: string): string {
    if (!/^(0|[1-9]\d*)$/.test(userId)) throw new Error('Invalid Cloud account identity');
    return `v1:${bytesToHex(sha256(utf8ToBytes(`supernote-cloud-account:v1:${userId}`)))}`;
}

export function requireBoundCloudAccount(manifest: SharedMirrorManifest, fingerprint: string): void {
    if (!fingerprint || !manifest.cloudAccountFingerprint
        || manifest.cloudAccountFingerprint !== fingerprint) {
        throw new Error('Cloud mirror account binding is missing or does not match');
    }
}

export function fromIpSyncManifest(legacy: SyncManifest): SharedMirrorManifest {
    // Migration is keyed by destination because that is the resource both
    // engines manage. Conflicting old sources cannot be merged safely.
    const records: Record<string, SharedMirrorRecord> = {};
    for (const record of Object.values(legacy)) {
        if (Object.hasOwn(records, record.vaultPath)) {
            throw new Error('IP manifest contains duplicate mirror destinations');
        }
        records[record.vaultPath] = {
            contentHash: record.contentHash,
            source: {
                engineId: 'ip-device',
                deviceUri: record.deviceUri,
                deviceDate: record.deviceDate,
                deviceSize: record.deviceSize,
            },
        };
    }
    return { version: 1, cloudAccountFingerprint: null, records };
}

export function toIpSyncManifest(manifest: SharedMirrorManifest): SyncManifest {
    const records: SyncManifest = {};
    for (const [vaultPath, record] of Object.entries(manifest.records)) {
        if (record.source.engineId !== 'ip-device') continue;
        if (Object.hasOwn(records, record.source.deviceUri)) {
            throw new Error('Shared mirror manifest contains duplicate IP sources');
        }
        records[record.source.deviceUri] = {
            deviceUri: record.source.deviceUri,
            deviceDate: record.source.deviceDate,
            deviceSize: record.source.deviceSize,
            vaultPath,
            contentHash: record.contentHash,
            lastSyncedAt: '',
        };
    }
    return records;
}

export function mergeIpSyncManifest(
    manifest: SharedMirrorManifest,
    ipManifest: SyncManifest,
): SharedMirrorManifest {
    const updatedIp = fromIpSyncManifest(ipManifest);
    const records = Object.fromEntries(Object.entries(manifest.records)
        .filter(([, record]) => record.source.engineId !== 'ip-device'));
    for (const [path, record] of Object.entries(updatedIp.records)) {
        records[path] = record;
    }
    return { ...manifest, records };
}

export function cloudPlanningRecords(manifest: SharedMirrorManifest): Record<string, CloudMirrorRecord> {
    return Object.fromEntries(Object.entries(manifest.records).map(([path, record]) => [
        path,
        { contentHash: record.contentHash, cloudMd5: record.source.engineId === 'supernote-cloud'
            ? record.source.md5 : undefined },
    ]));
}