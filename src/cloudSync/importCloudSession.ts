import type { App } from 'obsidian';
import { validateCloudProtocolSession } from '../../scripts/cloudProtocolSession';
import { CloudRequestBudget, NodeCloudProtocolTransport } from '../../scripts/cloudProtocolTransport';
import { CLOUD_PRODUCTION_ORIGIN } from './cloudPolicy';
import { CloudSessionStorage } from './cloudSessionStorage';
import { createObsidianCloudRequest } from './obsidianCloudRequest';

function parsePastedSession(input: string): { token: string; accountId: string | null } {
    const trimmed = input.trim();
    if (!trimmed) throw new Error('A Cloud access token is required');
    if (!trimmed.startsWith('{')) return { token: trimmed, accountId: null };

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed) as unknown;
    } catch {
        throw new Error('Cloud session cache is invalid');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Cloud session cache is invalid');
    }
    const session = parsed as Record<string, unknown>;
    if (session.version !== 1 || session.origin !== CLOUD_PRODUCTION_ORIGIN
        || typeof session.token !== 'string' || !session.token.trim()
        || typeof session.accountId !== 'string' || !/^(0|[1-9]\d*)$/.test(session.accountId)) {
        throw new Error('Cloud session cache is invalid');
    }
    return { token: session.token, accountId: session.accountId };
}

export async function importCloudSession(app: App, input: string): Promise<void> {
    if (!app.secretStorage?.getSecret || !app.secretStorage.setSecret) {
        throw new Error('This Obsidian runtime does not support SecretStorage');
    }
    const session = parsePastedSession(input);

    const storage = new CloudSessionStorage(app.secretStorage);
    const existing = storage.load();
    if (existing && session.accountId !== null && existing.accountId !== session.accountId) {
        throw new Error('Cloud session belongs to another account');
    }
    const transport = new NodeCloudProtocolTransport({
        session: 'interactive-token-import', budget: new CloudRequestBudget(4),
        fetchImplementation: createObsidianCloudRequest(),
    });
    const validated = await validateCloudProtocolSession(transport, {
        token: session.token,
        accountId: session.accountId ?? existing?.accountId ?? null,
        source: 'environment',
    });
    if (existing && existing.accountId !== validated.accountId) {
        throw new Error('Cloud session belongs to another account');
    }
    storage.save(validated);
    const stored = storage.load();
    if (stored?.accountId !== validated.accountId || stored.token !== validated.token) {
        throw new Error('SecretStorage did not retain the validated session');
    }
}