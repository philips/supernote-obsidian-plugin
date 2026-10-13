import { hashBytes } from '../deviceSync';
import { FileExtensionAllowlist } from '../syncFilters';
import { CloudInventoryPass } from './cloudInventory';
import { bindVerifiedCloudPaths, CloudMirrorPlan, planCloudMirror } from './cloudMirrorPlan';
import { CloudMirrorVault } from './cloudMirrorWrite';
import { cloudPlanningRecords, requireBoundCloudAccount, SharedMirrorManifest } from './sharedMirrorManifest';

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
    for (const candidate of initial.toDownload) {
        const bytes = await vault.read(candidate.vaultPath);
        localHashes[candidate.vaultPath] = bytes === null ? null : hashBytes(bytes);
    }
    return planCloudMirror(files, syncFolder, records, localHashes, pathFilters, fileExtensions);
}