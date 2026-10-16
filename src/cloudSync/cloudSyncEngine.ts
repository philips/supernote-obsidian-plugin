import { App, Notice, Platform } from 'obsidian';
import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { validateCloudProtocolSession } from '../../scripts/cloudProtocolSession';
import { CloudRequestBudget, NodeCloudProtocolTransport } from '../../scripts/cloudProtocolTransport';
import { SyncEngine, SyncRunResult, SyncTrigger } from '../syncAbstraction';
import { parsePathFilters, parseFileExtensionAllowlist } from '../syncFilters';
import { SupernotePluginSettings } from '../settings';
import { downloadCloudBytes } from './cloudDownload';
import { collectCloudInventory, queryCloudPath, verifyCloudInventoryPaths } from './cloudInventory';
import { CloudMirrorCandidate } from './cloudMirrorPlan';
import { runVerifiedCloudMirror } from './cloudMirrorPipeline';
import { CloudMirrorTransfer } from './cloudMirrorWrite';
import { CLOUD_DELETION_STABILITY_DELAY_MS, CLOUD_MAX_DESKTOP_FILE_BYTES, CLOUD_ROUTES } from './cloudPolicy';
import { CloudSessionStorage } from './cloudSessionStorage';
import { ObsidianCloudMirrorVault } from './obsidianCloudMirrorVault';
import { createObsidianCloudRequest } from './obsidianCloudRequest';
import { ObsidianMirrorManifestStorage } from './obsidianMirrorManifestStorage';
import { cloudAccountFingerprint, requireBoundCloudAccount } from './sharedMirrorManifest';
import { loadMirrorManifest, saveMirrorManifest } from './sharedMirrorManifestStore';

export class CloudSignInRequiredError extends Error {
    constructor() { super('Sign in to Supernote Cloud in settings to resume sync'); }
}

export class CloudSyncEngine implements SyncEngine {
    readonly id = 'supernote-cloud' as const;
    readonly name = 'Supernote cloud';

    constructor(
        private readonly app: App,
        private readonly settings: SupernotePluginSettings,
    ) {}

    getReadiness() {
        if (!Platform.isDesktop) return { ready: false, reason: 'Cloud mirroring currently requires Obsidian desktop' };
        if (!this.app.secretStorage) return { ready: false, reason: 'SecretStorage is unavailable' };
        try {
            return new CloudSessionStorage(this.app.secretStorage).load()
                ? { ready: true } : { ready: false, reason: 'Sign in to Supernote Cloud in settings to resume sync' };
        } catch {
            return { ready: false, reason: 'Cloud session storage is invalid' };
        }
    }

    async run(_trigger: SyncTrigger): Promise<SyncRunResult> {
        const session = new CloudSessionStorage(this.app.secretStorage).load();
        if (!session) throw new CloudSignInRequiredError();
        const transport = new NodeCloudProtocolTransport({
            session: 'cloud-mirror', budget: new CloudRequestBudget(5_000),
            fetchImplementation: createObsidianCloudRequest(),
        });
        try {
            await validateCloudProtocolSession(transport, { ...session, source: 'environment' });
        } catch (error) {
            if (error instanceof Error && error.message === 'Supernote Cloud request failed (HTTP 401)') {
                new CloudSessionStorage(this.app.secretStorage).clear();
                throw new CloudSignInRequiredError();
            }
            throw error;
        }
        const fingerprint = cloudAccountFingerprint(session.userId);
        const storage = new ObsidianMirrorManifestStorage(this.app, this.settings.syncFolder);
        let loaded = await loadMirrorManifest(storage, this.settings.noteSyncState);
        if (loaded.manifest.accountChange) throw new Error('Cloud account change must finish before sync');
        if (loaded.manifest.cloudAccountFingerprint === null) {
            loaded = await saveMirrorManifest(storage, loaded, {
                ...loaded.manifest, cloudAccountFingerprint: fingerprint,
            });
        }
        requireBoundCloudAccount(loaded.manifest, fingerprint);
        new Notice('Supernote cloud mirror started');

        const collectVerifiedInventory = async () => {
            const inventory = await collectCloudInventory(transport, session.token);
            const queriedPaths = new Map();
            for (const item of inventory.items) {
                queriedPaths.set(item.id, await queryCloudPath(transport, session.token, item.id));
            }
            return { inventory, canonicalPathsById: Object.fromEntries(verifyCloudInventoryPaths(inventory, queriedPaths)) };
        };
        const { inventory, canonicalPathsById } = await collectVerifiedInventory();
        const transfer: CloudMirrorTransfer = {
            md5: async (bytes) => bytesToHex(md5(bytes)),
            download: async (candidate: CloudMirrorCandidate) => {
                const descriptor = await transport.post(CLOUD_ROUTES.downloadDescriptor,
                    { id: candidate.item.id, type: '0' }, { accessToken: session.token });
                new Notice(`Supernote Cloud downloading: ${candidate.vaultPath}`);
                return downloadCloudBytes(descriptor, candidate.item.md5!, CLOUD_MAX_DESKTOP_FILE_BYTES);
            },
        };
        const result = await runVerifiedCloudMirror({
            inventory, canonicalPathsById, syncFolder: this.settings.syncFolder,
            legacyManifest: this.settings.noteSyncState, accountFingerprint: fingerprint,
            vault: new ObsidianCloudMirrorVault(this.app), storage, transfer,
            pathFilters: parsePathFilters(this.settings.syncPathFiltersRaw),
            fileExtensions: parseFileExtensionAllowlist(this.settings.syncFileExtensionsRaw),
            maxFileBytes: CLOUD_MAX_DESKTOP_FILE_BYTES,
            verifyDeletionInventory: async () => {
                await new Promise((resolve) => window.setTimeout(resolve, CLOUD_DELETION_STABILITY_DELAY_MS));
                return collectVerifiedInventory();
            },
        });
        return {
            engineId: this.id, synced: result.synced, unchanged: result.unchanged,
            excluded: result.excluded, removed: result.removed, removedFolders: result.removedFolders,
            issues: [
                ...result.protected.map((item) => ({ kind: 'protected' as const, item, message: 'Vault copy was edited locally' })),
                ...result.failureCategories.map((category, index) => ({ kind: 'failure' as const, item: result.failed[index], message: category })),
                ...result.warningCategories.map((category) => ({ kind: 'warning' as const, message: category })),
            ],
        };
    }

    async clearHistory(): Promise<void> {
        throw new Error('Cloud history cannot be cleared while account binding is active');
    }
}