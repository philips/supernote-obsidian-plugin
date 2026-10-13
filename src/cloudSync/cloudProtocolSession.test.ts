import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    clearCloudProtocolSession,
    loadCloudProtocolSession,
    saveCloudProtocolSession,
    savePendingCloudProtocolToken,
    validateCloudProtocolSession,
} from '../../scripts/cloudProtocolSession';
import { CloudControlPlaneTransport } from './cloudProtocol';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Cloud protocol session cache', () => {
    it('prefers an environment token without writing it to disk', async () => {
        await expect(loadCloudProtocolSession('https://cloud.supernote.com', {
            SUPERNOTE_CLOUD_ACCESS_TOKEN: 'environment-token',
            SUPERNOTE_CLOUD_ACCOUNT_ID: '9223372036854775807',
        })).resolves.toEqual({
            token: 'environment-token',
            accountId: '9223372036854775807',
            source: 'environment',
        });
    });

    it('round-trips a temporary session cache and removes it explicitly', async () => {
        const directory = await mkdtemp(resolve(tmpdir(), 'cloud-protocol-session-test-'));
        temporaryDirectories.push(directory);
        const path = resolve(directory, 'session.json');
        const environment = { SUPERNOTE_CLOUD_SESSION_FILE: path };

        await saveCloudProtocolSession(
            'https://cloud.supernote.com',
            'cached-token',
            '9223372036854775807',
            environment,
        );

        await expect(loadCloudProtocolSession('https://cloud.supernote.com', environment)).resolves.toEqual({
            token: 'cached-token',
            accountId: '9223372036854775807',
            source: 'temporary-file',
        });
        expect(await readFile(path, 'utf8')).toContain('cached-token');

        await clearCloudProtocolSession(environment);
        await expect(loadCloudProtocolSession('https://cloud.supernote.com', environment)).resolves.toBeNull();
    });

    it('keeps a candidate token separate from the validated session cache', async () => {
        const directory = await mkdtemp(resolve(tmpdir(), 'cloud-protocol-pending-test-'));
        temporaryDirectories.push(directory);
        const environment = { SUPERNOTE_CLOUD_SESSION_FILE: resolve(directory, 'session.json') };
        const path = await savePendingCloudProtocolToken('https://cloud.supernote.com', 'candidate-token', environment);
        expect(path).not.toBe(environment.SUPERNOTE_CLOUD_SESSION_FILE);
        expect(await readFile(path, 'utf8')).toContain('candidate-token');
        await expect(loadCloudProtocolSession('https://cloud.supernote.com', environment)).resolves.toBeNull();
    });

    it('rejects malformed account IDs without echoing the token', async () => {
        await expect(loadCloudProtocolSession('https://cloud.supernote.com', {
            SUPERNOTE_CLOUD_ACCESS_TOKEN: 'secret-token',
            SUPERNOTE_CLOUD_ACCOUNT_ID: '01',
        })).rejects.toThrow('canonical decimal string');
    });

    it('validates a reusable token against the cached account binding', async () => {
        const transport: CloudControlPlaneTransport = {
            async bootstrapCsrf() {},
            async post(_route, _body, options) {
                expect(options?.accessToken).toBe('cached-token');
                return {
                    status: 200,
                    body: '{"success":true,"userId":9223372036854775807}',
                };
            },
        };

        await expect(validateCloudProtocolSession(transport, {
            token: 'cached-token',
            accountId: '9223372036854775807',
            source: 'temporary-file',
        })).resolves.toEqual({
            token: 'cached-token',
            accountId: '9223372036854775807',
        });
    });
});