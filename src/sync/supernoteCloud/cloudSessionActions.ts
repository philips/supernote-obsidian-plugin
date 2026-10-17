import type { App } from 'obsidian';
import { CloudCredentials, authenticateCloudPassword } from './cloudAuth';
import { CloudControlPlaneTransport, parseCloudObject, requireCloudSuccess } from './cloudProtocol';
import { CLOUD_ROUTES } from './cloudPolicy';
import { CloudSessionStorage } from './cloudSessionStorage';
import { cloudAccountFingerprint } from '../sharedMirrorManifest';
import { loadMirrorManifest } from '../sharedMirrorManifestStore';
import { ObsidianMirrorManifestStorage } from '../obsidianMirrorManifestStorage';
import type { SupernotePluginSettings } from '../../settings';
import { CloudRequestBudget, NodeCloudProtocolTransport } from '../../../scripts/cloudProtocolTransport';
import { createObsidianCloudRequest } from './obsidianCloudRequest';
import { changeCloudMirrorAccount } from './cloudAccountChange';
import { ObsidianCloudMirrorVault } from './obsidianCloudMirrorVault';
import { parsePathFilters, parseFileExtensionAllowlist } from '../syncFilters';

export function createCloudAuthTransport(): CloudControlPlaneTransport {
    return new NodeCloudProtocolTransport({
        session: 'interactive-sign-in', budget: new CloudRequestBudget(),
        fetchImplementation: createObsidianCloudRequest(),
    });
}

export async function signInCloud(
    app: App,
    settings: SupernotePluginSettings,
    credentials: CloudCredentials,
    getVerificationCode: () => Promise<string>,
    isCancelled: () => boolean,
    transport: CloudControlPlaneTransport = createCloudAuthTransport(),
    confirmChange?: () => Promise<boolean>,
    runExclusive: <T>(operation: () => Promise<T>) => Promise<T> = (operation) => operation(),
): Promise<string[] | null> {
    if (!app.secretStorage?.getSecret || !app.secretStorage.setSecret) {
        throw new Error('SecretStorage is unavailable');
    }
    const storage = new CloudSessionStorage(app.secretStorage);
    const session = await authenticateCloudPassword(transport, credentials, { getVerificationCode });
    if (isCancelled()) return null;
    return runExclusive(async () => {
        const existing = storage.load();
        const manifestStorage = new ObsidianMirrorManifestStorage(app, settings.syncFolder);
        const loaded = await loadMirrorManifest(manifestStorage, settings.noteSyncState);
        const fingerprint = cloudAccountFingerprint(session.userId);
        const accountChanged = (existing !== null && existing.userId !== session.userId)
            || (loaded.manifest.cloudAccountFingerprint !== null
                && loaded.manifest.cloudAccountFingerprint !== fingerprint)
            || loaded.manifest.accountChange !== undefined;
        let protectedPaths: string[] = [];
        if (accountChanged) {
            if (!confirmChange || !await confirmChange() || isCancelled()) return null;
            if (loaded.manifest.cloudAccountFingerprint !== null
                && (loaded.manifest.cloudAccountFingerprint !== fingerprint || loaded.manifest.accountChange)) {
                const result = await changeCloudMirrorAccount(manifestStorage, loaded,
                    new ObsidianCloudMirrorVault(app), fingerprint, settings.syncFolder,
                    parsePathFilters(settings.syncPathFiltersRaw),
                    parseFileExtensionAllowlist(settings.syncFileExtensionsRaw));
                protectedPaths = result.protectedPaths;
            }
        }
        // A confirmed reset must still establish the verified binding even if the modal closes.
        if (isCancelled() && !accountChanged) return null;
        if (existing?.userId !== session.userId) storage.clear();
        try {
            storage.save(session);
            const stored = storage.load();
            if (stored?.token !== session.token || stored.userId !== session.userId) {
                throw new Error('SecretStorage did not retain the validated session');
            }
        } catch (error) {
            storage.clear();
            if (existing) storage.save(existing);
            throw error;
        }
        return protectedPaths;
    });
}

export async function signOutCloud(
    app: App,
    transport: CloudControlPlaneTransport = createCloudAuthTransport(),
): Promise<void> {
    if (!app.secretStorage?.getSecret || !app.secretStorage.setSecret) {
        throw new Error('SecretStorage is unavailable');
    }
    const storage = new CloudSessionStorage(app.secretStorage);
    let token: string | null = null;
    try {
        token = storage.load()?.token ?? null;
    } finally {
        storage.clear();
    }
    if (token) {
        try {
            await transport.bootstrapCsrf();
            requireCloudSuccess(parseCloudObject(await transport.post(CLOUD_ROUTES.logout, {}, { accessToken: token })));
        } catch {
            // Remote logout is best effort; the local token is already removed.
        }
    }
}