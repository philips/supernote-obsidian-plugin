import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { env as processEnvironment } from 'node:process';
import { queryCloudAccountIdentity } from '../src/cloudSync/cloudAuth';
import { CloudControlPlaneTransport, CloudProtocolError } from '../src/cloudSync/cloudProtocol';

const SESSION_VERSION = 1;
const SESSION_DIRECTORY = 'obsidian-supernote-companion';
const SESSION_FILENAME = 'cloud-protocol-session.json';
const PENDING_SESSION_FILENAME = 'cloud-protocol-pending-token.json';

export interface CloudProtocolSession {
    token: string;
    userId: string | null;
    source: 'environment' | 'temporary-file';
}

interface StoredCloudProtocolSession {
    version: 1;
    origin: string;
    token: string;
    accountId: string;
    savedAt: string;
}

type CloudProtocolEnvironment = Record<string, string | undefined>;

export function getCloudProtocolSessionPath(environment: CloudProtocolEnvironment = processEnvironment): string {
    return environment.SUPERNOTE_CLOUD_SESSION_FILE
        ?? resolve(tmpdir(), SESSION_DIRECTORY, SESSION_FILENAME);
}

export async function loadCloudProtocolSession(
    origin: string,
    environment: CloudProtocolEnvironment = processEnvironment,
): Promise<CloudProtocolSession | null> {
    const environmentToken = environment.SUPERNOTE_CLOUD_ACCESS_TOKEN?.trim();
    if (environmentToken) {
        const userId = environment.SUPERNOTE_CLOUD_ACCOUNT_ID?.trim() || null;
        if (userId !== null && !isCanonicalDecimal(userId)) {
            throw new CloudProtocolError('SUPERNOTE_CLOUD_ACCOUNT_ID must be a canonical decimal string');
        }
        return { token: environmentToken, userId, source: 'environment' };
    }

    let raw: string;
    try {
        raw = await readFile(getCloudProtocolSessionPath(environment), 'utf8');
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') return null;
        throw new CloudProtocolError('Cloud protocol session cache could not be read');
    }

    let stored: unknown;
    try {
        stored = JSON.parse(raw) as unknown;
    } catch {
        throw new CloudProtocolError('Cloud protocol session cache is malformed');
    }
    if (!isStoredSession(stored) || stored.origin !== origin) {
        throw new CloudProtocolError('Cloud protocol session cache is invalid for this origin');
    }
    return {
        token: stored.token,
        userId: stored.accountId,
        source: 'temporary-file',
    };
}

export async function saveCloudProtocolSession(
    origin: string,
    token: string,
    userId: string,
    environment: CloudProtocolEnvironment = processEnvironment,
): Promise<string> {
    if (!token || !isCanonicalDecimal(userId)) {
        throw new CloudProtocolError('Cloud protocol session cannot be cached');
    }
    const path = getCloudProtocolSessionPath(environment);
    const stored: StoredCloudProtocolSession = {
        version: SESSION_VERSION,
        origin,
        token,
        accountId: userId,
        savedAt: new Date().toISOString(),
    };
    try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify(stored)}\n`, { encoding: 'utf8', mode: 0o600 });
        await chmod(path, 0o600);
    } catch {
        throw new CloudProtocolError('Cloud protocol session cache could not be written');
    }
    return path;
}

export async function clearCloudProtocolSession(
    environment: CloudProtocolEnvironment = processEnvironment,
): Promise<void> {
    try {
        await rm(getCloudProtocolSessionPath(environment), { force: true });
    } catch {
        throw new CloudProtocolError('Cloud protocol session cache could not be removed');
    }
}

export async function validateCloudProtocolSession(
    transport: CloudControlPlaneTransport,
    session: CloudProtocolSession,
): Promise<{ token: string; userId: string }> {
    await transport.bootstrapCsrf();
    const userId = await queryCloudAccountIdentity(transport, session.token);
    if (session.userId !== null && session.userId !== userId) {
        throw new CloudProtocolError('Cloud protocol session account identity does not match the cached binding');
    }
    return { token: session.token, userId };
}

function isStoredSession(value: unknown): value is StoredCloudProtocolSession {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const candidate = value as Partial<StoredCloudProtocolSession>;
    return candidate.version === SESSION_VERSION
        && typeof candidate.origin === 'string'
        && typeof candidate.token === 'string'
        && candidate.token.length > 0
        && typeof candidate.accountId === 'string'
        && isCanonicalDecimal(candidate.accountId)
        && typeof candidate.savedAt === 'string';
}

function isCanonicalDecimal(value: string): boolean {
    return /^(0|[1-9]\d*)$/.test(value);
}

function isNodeError(error: unknown): error is Error & { code: string } {
    return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

// A candidate token may arrive before account identity can be queried. Keep it
// separate from the reusable cache so a failed identity check never promotes
// an unbound token, but an interrupted probe does not lose the only token.
export async function savePendingCloudProtocolToken(
    origin: string,
    token: string,
    environment: CloudProtocolEnvironment = processEnvironment,
): Promise<string> {
    if (!token) throw new CloudProtocolError('Cloud protocol token cannot be cached');
    const path = resolve(dirname(getCloudProtocolSessionPath(environment)), PENDING_SESSION_FILENAME);
    try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify({ version: SESSION_VERSION, origin, token })}\n`, {
            encoding: 'utf8', mode: 0o600,
        });
        await chmod(path, 0o600);
    } catch {
        throw new CloudProtocolError('Cloud protocol pending token could not be written');
    }
    return path;
}