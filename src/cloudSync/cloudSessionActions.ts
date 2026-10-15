import type { App } from 'obsidian';
import { CloudCredentials, authenticateCloudPassword } from './cloudAuth';
import { CloudControlPlaneTransport, parseCloudObject, requireCloudSuccess } from './cloudProtocol';
import { CLOUD_ROUTES } from './cloudPolicy';
import { CloudSessionStorage } from './cloudSessionStorage';
import { cloudAccountFingerprint } from './sharedMirrorManifest';
import { loadMirrorManifest } from './sharedMirrorManifestStore';
import { ObsidianMirrorManifestStorage } from './obsidianMirrorManifestStorage';
import type { SupernotePluginSettings } from '../settings';
import { CloudRequestBudget, NodeCloudProtocolTransport } from '../../scripts/cloudProtocolTransport';
import { createObsidianCloudRequest } from './obsidianCloudRequest';

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
): Promise<void> {
    if (!app.secretStorage?.getSecret || !app.secretStorage.setSecret) {
        throw new Error('SecretStorage is unavailable');
    }
    const storage = new CloudSessionStorage(app.secretStorage);
    const session = await authenticateCloudPassword(transport, credentials, { getVerificationCode });
    if (isCancelled()) return;
    const existing = storage.load();
    if (existing && existing.accountId !== session.accountId) {
        throw new Error('Cloud session belongs to another account');
    }
    const { manifest } = await loadMirrorManifest(
        new ObsidianMirrorManifestStorage(app, settings.syncFolder), settings.noteSyncState,
    );
    if (manifest.cloudAccountFingerprint !== null
        && manifest.cloudAccountFingerprint !== cloudAccountFingerprint(session.accountId)) {
        throw new Error('Cloud mirror account binding does not match');
    }
    if (isCancelled()) return;
    storage.save(session);
    const stored = storage.load();
    if (stored?.token !== session.token || stored.accountId !== session.accountId) {
        if (existing) storage.save(existing);
        else storage.clear();
        throw new Error('SecretStorage did not retain the validated session');
    }
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