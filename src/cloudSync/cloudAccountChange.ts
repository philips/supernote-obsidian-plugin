import { hashBytes } from '../deviceSync';
import { CloudMirrorVault } from './cloudMirrorWrite';
import { LoadedMirrorManifest, MirrorManifestStorage, saveMirrorManifest } from './sharedMirrorManifestStore';
import { matchesAnyPathPattern, matchesFileExtension, FileExtensionAllowlist } from '../syncFilters';
import { MIRROR_METADATA_DIRECTORY } from './sharedMirrorManifest';

export async function changeCloudMirrorAccount(
    storage: MirrorManifestStorage,
    loaded: LoadedMirrorManifest,
    vault: CloudMirrorVault,
    targetFingerprint: string,
    root: string,
    pathFilters: readonly string[],
    fileExtensions: FileExtensionAllowlist,
): Promise<{ protectedPaths: string[] }> {
    if (!vault.trash) throw new Error('Obsidian Trash is unavailable');
    if (loaded.manifest.cloudAccountFingerprint === null) {
        throw new Error('Cloud mirror has no account binding to change');
    }
    const prefix = `${root.replace(/^\/+|\/+$/g, '')}/`;
    for (const path of Object.keys(loaded.manifest.records)) {
        if (!path.startsWith(prefix)) throw new Error('Shared mirror record is outside the sync root');
    }
    const change = loaded.manifest.accountChange;
    if (change && change.targetFingerprint !== targetFingerprint) {
        throw new Error('Cloud mirror account change is already in progress');
    }
    if (!change) {
        loaded = await saveMirrorManifest(storage, loaded, {
            ...loaded.manifest, accountChange: { targetFingerprint, pendingPath: null, protectedPaths: [] },
        });
    }

    while (true) {
        const pendingPath: string | null = loaded.manifest.accountChange!.pendingPath;
        const path: string | undefined = pendingPath ?? Object.keys(loaded.manifest.records)
            .sort().find((candidate) => loaded.manifest.records[candidate].source.engineId === 'supernote-cloud');
        if (!path) break;
        if (!pendingPath) {
            loaded = await saveMirrorManifest(storage, loaded, {
                ...loaded.manifest, accountChange: { ...loaded.manifest.accountChange!, pendingPath: path },
            });
        }
        const record = loaded.manifest.records[path];
        const relative = `/${path.slice(prefix.length)}`;
        const reserved = relative.toLowerCase() === '/sync log.md'
            || relative.toLowerCase().startsWith(`/${MIRROR_METADATA_DIRECTORY}/`);
        const inScope = !reserved && matchesAnyPathPattern([relative], pathFilters)
            && matchesFileExtension(path.split('/').at(-1)!, fileExtensions);
        const bytes = inScope ? await vault.read(path) : null;
        const edited = bytes !== null && hashBytes(bytes) !== record.contentHash;
        if (edited) {
            // The file remains unmanaged after reset so a new account cannot overwrite it.
        } else if (bytes !== null) {
            await vault.trash(path);
        }
        const records = { ...loaded.manifest.records };
        delete records[path];
        loaded = await saveMirrorManifest(storage, loaded, {
            ...loaded.manifest, records, accountChange: {
                ...loaded.manifest.accountChange!, pendingPath: null,
                protectedPaths: edited || !inScope
                    ? [...loaded.manifest.accountChange!.protectedPaths, path]
                    : loaded.manifest.accountChange!.protectedPaths,
            },
        });
    }
    const protectedPaths = loaded.manifest.accountChange!.protectedPaths;
    const { accountChange: _accountChange, ...manifest } = loaded.manifest;
    await saveMirrorManifest(storage, loaded, { ...manifest, cloudAccountFingerprint: targetFingerprint });
    return { protectedPaths };
}