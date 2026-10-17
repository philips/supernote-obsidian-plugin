import { hashBytes, SyncManifest } from '../directIP/deviceSync';
import { FileExtensionAllowlist, matchesAnyPathPattern, matchesFileExtension } from '../syncFilters';
import { cloudInventoryFingerprint, CloudInventoryPass } from './cloudInventory';
import { bindVerifiedCloudPaths, CloudMirrorPlan, missingManagedCloudPaths, planCloudMirror } from './cloudMirrorPlan';
import { applyCloudDownload, CloudMirrorTransfer, CloudMirrorVault } from './cloudMirrorWrite';
import { cloudPlanningRecords, MIRROR_METADATA_DIRECTORY, requireBoundCloudAccount, SharedMirrorManifest } from '../sharedMirrorManifest';
import { MirrorManifestService, MirrorManifestStorage, RootMirrorManifestService } from '../sharedMirrorManifestStore';
import { MirrorOperationError, MirrorOperationExecutor } from '../mirrorOperationExecutor';

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
    manifestService?: MirrorManifestService;
    transfer: CloudMirrorTransfer;
    pathFilters: readonly string[];
    fileExtensions: FileExtensionAllowlist;
    maxFileBytes: number;
    verifyDeletionInventory?: () => Promise<{
        inventory: CloudInventoryPass;
        canonicalPathsById: Readonly<Record<string, string>>;
    }>;
}

export async function runVerifiedCloudMirror(options: CloudMirrorRunOptions): Promise<{
    synced: number; unchanged: number; excluded: number; removed: number; removedFolders: number;
    protected: string[]; failed: string[];
    failureCategories: string[]; warningCategories: string[];
}> {
    const manifestService = options.manifestService ?? new RootMirrorManifestService(() => options.storage);
    let loaded = await manifestService.load(options.legacyManifest);
    requireBoundCloudAccount(loaded.manifest, options.accountFingerprint);
    const executor = new MirrorOperationExecutor(manifestService, options.syncFolder, loaded,
        (path) => options.vault.read(path));
    const plan = await planVerifiedCloudInventory(options.inventory, options.canonicalPathsById,
        options.syncFolder, loaded.manifest, options.accountFingerprint, options.vault,
        options.pathFilters, options.fileExtensions);
    const result = {
        synced: 0, unchanged: plan.unchanged.length, excluded: plan.excluded.length, removed: 0, removedFolders: 0,
        protected: plan.protected.map((candidate) => candidate.vaultPath),
        failed: plan.missingChecksum.map((candidate) => candidate.vaultPath),
        failureCategories: plan.missingChecksum.map(() => 'Missing Cloud checksum'),
        warningCategories: [] as string[],
    };
    for (const candidate of plan.toDownload) {
        let write: Awaited<ReturnType<typeof applyCloudDownload>>;
        try {
            write = await applyCloudDownload(candidate, executor.manifest, options.accountFingerprint,
                options.vault, options.transfer, options.maxFileBytes, executor);
        } catch (error) {
            if (error instanceof MirrorOperationError) throw error;
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
        if (executor.manifest.pendingOperation) throw new Error('Pending mirror operation requires recovery');
        if (write.outcome === 'written') result.synced++;
        else result.unchanged++;
    }

    const files = bindVerifiedCloudPaths(options.inventory, options.canonicalPathsById);
    const candidates = missingManagedCloudPaths(files, options.syncFolder,
        cloudPlanningRecords(executor.manifest), options.pathFilters, options.fileExtensions);
    const root = options.syncFolder.replace(/^\/+|\/+$/g, '');
    const folders = options.vault.listFolders && options.vault.trashEmptyFolder
        ? await options.vault.listFolders(root) : [];
    const inScope = files.filter((file) => !file.item.isFolder
        && matchesAnyPathPattern([file.canonicalPath], options.pathFilters)
        && matchesFileExtension(file.canonicalPath.split('/').at(-1)!, options.fileExtensions))
        .map((file) => `${root}${file.canonicalPath}`);
    const trashedFolders = new Set<string>();
    if (candidates.length > 0 || folders.length > 0) {
        if (!options.verifyDeletionInventory || !options.vault.trash) {
            throw new Error('Cloud deletion verification or Trash is unavailable');
        }
        try {
            const second = await options.verifyDeletionInventory();
            if (cloudInventoryFingerprint(options.inventory, options.canonicalPathsById)
                !== cloudInventoryFingerprint(second.inventory, second.canonicalPathsById)) {
                result.warningCategories.push('Cloud inventory changed; deletion skipped');
                return result;
            }
        } catch {
            result.warningCategories.push('Cloud deletion inventory incomplete; deletion skipped');
            return result;
        }
        for (const path of candidates) {
            let trashed = false;
            try {
                const bytes = await options.vault.read(path);
                if (bytes && hashBytes(bytes) !== executor.manifest.records[path].contentHash) {
                    result.protected.push(path);
                    continue;
                }
                if (bytes) {
                    await executor.trash(path, (target) => options.vault.trash!(target));
                    result.removed++;
                    trashed = true;
                }
            } catch (error) {
                if (error instanceof MirrorOperationError) throw error;
                result.failed.push(path);
                result.failureCategories.push('Cloud mirror Trash or vault operation failed');
                continue;
            }
            if (!trashed) await executor.retire(path);
            if (trashed && options.vault.trashEmptyFolder) {
                let parent = path.slice(0, path.lastIndexOf('/'));
                while (parent.startsWith(`${root}/`)
                    && parent.slice(root.length + 1).split('/').every((segment) => segment && segment !== '.' && segment !== '..')
                    && !inScope.some((file) => file.startsWith(`${parent}/`))) {
                    try {
                        if (!await options.vault.trashEmptyFolder(parent)) break;
                        trashedFolders.add(parent);
                        result.removedFolders++;
                    } catch {
                        result.warningCategories.push('Cloud mirror folder cleanup failed');
                        break;
                    }
                    parent = parent.slice(0, parent.lastIndexOf('/'));
                }
            }
        }
        if (result.failed.length === 0 && options.vault.trashEmptyFolder) {
            for (const folder of folders.sort((left, right) => right.length - left.length)) {
                if (trashedFolders.has(folder) || !folder.startsWith(`${root}/`)
                    || folder.split('/').some((segment) => !segment || segment === '.' || segment === '..')
                    || folder === `${root}/${MIRROR_METADATA_DIRECTORY}`
                    || folder.startsWith(`${root}/${MIRROR_METADATA_DIRECTORY}/`)
                    || inScope.some((path) => path.startsWith(`${folder}/`))) continue;
                try {
                    if (await options.vault.trashEmptyFolder(folder)) {
                        trashedFolders.add(folder);
                        result.removedFolders++;
                    }
                } catch {
                    result.warningCategories.push('Cloud mirror folder cleanup failed');
                }
            }
        }
    }
    return result;
}