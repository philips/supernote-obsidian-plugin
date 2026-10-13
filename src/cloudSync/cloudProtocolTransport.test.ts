import { describe, expect, it } from 'vitest';
import { authenticateCloudPassword } from './cloudAuth';
import { formatCloudAuthIdentityObservation, formatCloudInventoryObservation } from './cloudProtocolEvidence';
import { CloudRequestBudget, NodeCloudProtocolTransport } from '../../scripts/cloudProtocolTransport';

describe('Node Cloud protocol transport', () => {
    it('retains cookies, refreshes CSRF once, and records only structural evidence', async () => {
        const requests: { url: string; headers: Headers }[] = [];
        let csrfRequests = 0;
        let nonceRequests = 0;
        const fetchImplementation: typeof fetch = async (input, init) => {
            const url = input instanceof Request
                ? input.url
                : input instanceof URL
                    ? input.href
                    : input;
            const headers = new Headers(init?.headers);
            requests.push({ url, headers });

            if (url.endsWith('/api/csrf')) {
                csrfRequests++;
                return new Response('', {
                    status: 200,
                    headers: [
                        ['Set-Cookie', `session=session-secret-${csrfRequests}; Path=/; HttpOnly`],
                        ['Set-Cookie', `XSRF-TOKEN=csrf-secret-${csrfRequests}; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/`],
                        ['X-XSRF-TOKEN', `csrf-secret-${csrfRequests}`],
                    ],
                });
            }
            if (url.endsWith('/api/official/user/query/random/code')) {
                nonceRequests++;
                if (nonceRequests === 1) return new Response('', { status: 403 });
                return Response.json({ success: true, randomCode: '12345678', timestamp: 1720000000000 });
            }
            if (url.endsWith('/api/official/user/account/login/new')) {
                return Response.json({ success: false, errorCode: 'E1760' });
            }
            if (url.endsWith('/api/user/validcode/pre-auth')) {
                return Response.json({ success: true, token: 'zero-signing-key-two-1' });
            }
            if (url.endsWith('/api/user/mail/validcode/send')) {
                return Response.json({ success: true, validCodeKey: 'valid-code-key-secret' });
            }
            if (url.endsWith('/api/official/user/sms/login')) {
                return new Response('{"success":true}', {
                    status: 200,
                    headers: [
                        ['Content-Type', 'application/json'],
                        ['Set-Cookie', 'XSRF-TOKEN=rotated-csrf-secret; Path=/'],
                    ],
                });
            }
            if (url.endsWith('/api/user/query/token')) {
                return Response.json({ success: true, token: 'token-secret' });
            }
            if (url.endsWith('/api/user/query')) {
                return new Response('{"success":true,"userId":9223372036854775807}', {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response('', { status: 404 });
        };

        const transport = new NodeCloudProtocolTransport({
            session: 'synthetic',
            budget: new CloudRequestBudget(12),
            origin: 'https://cloud.test',
            fetchImplementation,
        });
        const session = await authenticateCloudPassword(transport, {
            email: 'account-secret@example.com',
            password: 'password-secret',
        }, {
            getVerificationCode: async () => '654321',
        });

        expect(session.accountId).toBe('9223372036854775807');
        expect(session.emailVerificationUsed).toBe(true);
        expect(csrfRequests).toBe(2);
        expect(requests[1].headers.get('cookie')).toContain('session=session-secret-1');
        expect(requests[1].headers.get('x-xsrf-token')).toBe('csrf-secret-1');
        expect(requests.at(-1)?.headers.get('x-access-token')).toBe('token-secret');
        const tokenQuery = requests.find((request) => request.url.endsWith('/api/user/query/token'));
        expect(tokenQuery?.headers.get('x-xsrf-token')).toBe('rotated-csrf-secret');
        expect(transport.evidence.flatMap((entry) => entry.cookieNames)).toContain('XSRF-TOKEN');

        const report = formatCloudAuthIdentityObservation({
            date: '2026-10-12',
            origin: 'https://cloud.supernote.com',
            harnessCommit: 'abc123',
            cloudImplementationCommit: 'abc123',
            accountIdentityHash: 'safe-account-hash',
            emailVerificationUsed: true,
            requests: transport.evidence,
        });
        for (const secret of [
            'account-secret@example.com',
            'password-secret',
            'token-secret',
            'session-secret-1',
            'csrf-secret-1',
            'rotated-csrf-secret',
            'zero-signing-key-two-1',
            'valid-code-key-secret',
            '654321',
            '9223372036854775807',
            '12345678',
        ]) {
            expect(report).not.toContain(secret);
        }
        expect(report).toContain('account:string');
        expect(report).toContain('loginMethod:string="1"');
        expect(report).toContain('userId:integer');
        expect(report).toContain('Email verification gate: pass');
    });

    it('enforces the absolute request budget', async () => {
        const transport = new NodeCloudProtocolTransport({
            session: 'bounded',
            budget: new CloudRequestBudget(0),
            origin: 'https://cloud.test',
            fetchImplementation: async () => new Response(),
        });

        await expect(transport.bootstrapCsrf()).rejects.toThrow('request limit exceeded');
    });

    it('rejects insecure or credential-bearing origins before any request', () => {
        for (const origin of ['http://cloud.test', 'https://user:secret@cloud.test']) {
            expect(() => new NodeCloudProtocolTransport({
                session: 'unsafe',
                budget: new CloudRequestBudget(),
                origin,
            })).toThrow('credential-free HTTPS');
        }
    });

    it('formats inventory evidence without account paths, names, IDs, or tokens', () => {
        const report = formatCloudInventoryObservation({
            date: '2026-10-13',
            origin: 'https://cloud.supernote.com',
            harnessCommit: 'abc123',
            cloudImplementationCommit: 'abc123',
            sessionSource: 'temporary-file',
            accountIdentityHash: 'account-hash',
            directoryCount: 2,
            itemCount: 3,
            fileCount: 2,
            folderCount: 1,
            maximumObservedPageCount: 1,
            secondPageObserved: false,
            firstInventoryFingerprint: 'first-hash',
            secondInventoryFingerprint: 'first-hash',
            inventoryStable: true,
            pathQueryCount: 3,
            pathMatchesParent: 3,
            pathMatchesItem: 0,
            pathMatchesNeither: 0,
            allQueryPathsAbsolute: true,
            allQueryPathsTrailingSlash: true,
            allIdPathsAbsolute: true,
            allIdPathsTrailingSlash: true,
            requests: [],
        });

        expect(report).toContain('incomplete fixture: no second page was observed');
        expect(report).toContain('Session source: temporary-file');
        for (const secret of [
            'Personal Note.note',
            '/Note/Personal Note.note',
            '9223372036854775807',
            'cached-token',
        ]) {
            expect(report).not.toContain(secret);
        }
    });
});