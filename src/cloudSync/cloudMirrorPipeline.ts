import { hashBytes, SyncManifest } from '../deviceSync';
import { FileExtensionAllowlist } from '../syncFilters';
import { CloudInventoryPass } from './cloudInventory';
import { bindVerifiedCloudPaths, CloudMirrorPlan, planCloudMirror } from './cloudMirrorPlan';
import { applyCloudDownload, CloudMirrorTransfer, CloudMirrorVault } from './cloudMirrorWrite';
import { cloudPlanningRecords, requireBoundCloudAccount, SharedMirrorManifest } from './sharedMirrorManifest';
import { loadMirrorManifest, MirrorManifestStorage, saveMirrorManifest } from './sharedMirrorManifestStore';

// Keep inventory binding and vault inspection separate from network transport.
// Only planned in-scope destinations are read; canonical-path or account
// failures therefore stop before any vault access.
export async function planVerifiedCloudInventory(
    inventory: CloudInventoryPass,
    canonicalPathsById: Readonly<Record<string, string>>,
    syncFolder: string,
    manifest: SharedMirrorManifest,
    accountFingerprint: string,
    vault: CloudMirrorVault,
    pathFilters: readonly string[],
    fileExtensions: FileExtensionAllowlist,
): Promise<CloudMirrorPlan> {
    requireBoundCloudAccount(manifest, accountFingerprint);
    const files = bindVerifiedCloudPaths(inventory, canonicalPathsById);
    const records = cloudPlanningRecords(manifest);
    const initial = planCloudMirror(files, syncFolder, records, {}, pathFilters, fileExtensions);
    const localHashes: Record<string, string | null> = {};
    // The first plan selects checksum changes/re-baselines; hash those local
    // destinations, then re-plan so edits are protected before a download starts.
    for (const candidate of initial.toDownload) {
        const bytes = await vault.read(candidate.vaultPath);
        localHashes[candidate.vaultPath] = bytes === null ? null : hashBytes(bytes);
    }
    return planCloudMirror(files, syncFolder, records, localHashes, pathFilters, fileExtensions);
}

export interface CloudMirrorRunOptions {
    inventory: CloudInventoryPass;
    canonicalPathsById: Readonly<Record<string, string>>;
    syncFolder: string;
    legacyManifest: SyncManifest;
    accountFingerprint: string;
    vault: CloudMirrorVault;
    storage: MirrorManifestStorage;
    transfer: CloudMirrorTransfer;
    pathFilters: readonly string[];
    fileExtensions: FileExtensionAllowlist;
    maxFileBytes: number;
}

export async function runVerifiedCloudMirror(options: CloudMirrorRunOptions): Promise<{
    synced: number; unchanged: number; excluded: number; protected: string[]; failed: string[];
    failureCategories: string[];
}> {
    let loaded = await loadMirrorManifest(options.storage, options.legacyManifest);
    requireBoundCloudAccount(loaded.manifest, options.accountFingerprint);
    const plan = await planVerifiedCloudInventory(options.inventory, options.canonicalPathsById,
        options.syncFolder, loaded.manifest, options.accountFingerprint, options.vault,
        options.pathFilters, options.fileExtensions);
    const result = {
        synced: 0, unchanged: plan.unchanged.length, excluded: plan.excluded.length,
        protected: plan.protected.map((candidate) => candidate.vaultPath),
        failed: plan.missingChecksum.map((candidate) => candidate.vaultPath),
        failureCategories: plan.missingChecksum.map(() => 'Missing Cloud checksum'),
    };
    for (const candidate of plan.toDownload) {
        let write: Awaited<ReturnType<typeof applyCloudDownload>>;
        try {
            write = await applyCloudDownload(candidate, loaded.manifest, options.accountFingerprint,
                options.vault, options.transfer, options.maxFileBytes);
        } catch (error) {
            result.failed.push(candidate.vaultPath);
            result.failureCategories.push(error instanceof Error && [
                'Cloud download descriptor checksum does not match inventory',
                'Cloud download request failed',
                'Cloud download failed size or checksum validation',
                'Cloud download exceeds size limit',
            ].includes(error.message) ? error.message : 'Cloud transfer or vault write failed');
            continue;
        }
        if (write.outcome === 'protected') {
            result.protected.push(candidate.vaultPath);
            continue;
        }
        // A failed manifest commit after a successful vault write makes the
        // next overwrite unsafe; stop rather than continuing under old history.
        loaded = await saveMirrorManifest(options.storage, loaded, write.manifest);
        if (write.outcome === 'written') result.synced++;
        else result.unchanged++;
    }
    return result;
}