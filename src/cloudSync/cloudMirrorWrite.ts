import { hashBytes } from '../deviceSync';
import { CloudMirrorCandidate } from './cloudMirrorPlan';
import { requireBoundCloudAccount, SharedMirrorManifest } from './sharedMirrorManifest';

export interface CloudMirrorVault {
    read(path: string): Promise<Uint8Array | null>;
    write(path: string, bytes: Uint8Array): Promise<void>;
}

export interface CloudMirrorTransfer {
    download(candidate: CloudMirrorCandidate): Promise<Uint8Array>;
    md5(bytes: Uint8Array): Promise<string>;
}

export interface CloudMirrorWriteResult {
    outcome: 'written' | 'already-current' | 'protected';
    manifest: SharedMirrorManifest;
}

export async function applyCloudDownload(
    candidate: CloudMirrorCandidate,
    manifest: SharedMirrorManifest,
    accountFingerprint: string,
    vault: CloudMirrorVault,
    transfer: CloudMirrorTransfer,
    maxFileBytes: number,
): Promise<CloudMirrorWriteResult> {
    requireBoundCloudAccount(manifest, accountFingerprint);
    const advertisedSize = candidate.item.size;
    const expectedMd5 = candidate.item.md5;
    if (!advertisedSize || !/^\d+$/.test(advertisedSize)
        || BigInt(advertisedSize) > BigInt(maxFileBytes)
        || !expectedMd5 || !/^[a-f\d]{32}$/i.test(expectedMd5)) {
        throw new Error('Cloud file has invalid or oversized transfer metadata');
    }

    const bytes = await transfer.download(candidate);
    if (bytes.length > maxFileBytes || bytes.length !== Number(advertisedSize)
        || (await transfer.md5(bytes)).toLowerCase() !== expectedMd5.toLowerCase()) {
        throw new Error('Cloud download failed size or checksum validation');
    }

    const existing = await vault.read(candidate.vaultPath);
    const existingHash = existing === null ? null : hashBytes(existing);
    const incomingHash = hashBytes(bytes);
    const record = manifest.records[candidate.vaultPath];
    if (existingHash !== null && (record
        ? existingHash !== record.contentHash
        : existingHash !== incomingHash)) {
        return { outcome: 'protected', manifest };
    }

    const outcome = existingHash === incomingHash ? 'already-current' : 'written';
    if (outcome === 'written') await vault.write(candidate.vaultPath, bytes);
    return {
        outcome,
        manifest: {
            ...manifest,
            records: {
                ...manifest.records,
                [candidate.vaultPath]: {
                    contentHash: incomingHash,
                    source: { engineId: 'supernote-cloud', md5: expectedMd5 },
                },
            },
        },
    };
}