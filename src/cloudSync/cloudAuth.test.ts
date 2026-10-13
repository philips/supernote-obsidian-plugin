import { describe, expect, it } from 'vitest';
import {
    authenticateCloudPassword,
    CloudVerificationCodeRejectedError,
    CloudVerificationRequiredError,
    deriveCloudPassword,
    deriveCloudVerificationSign,
    verifyCloudAuthIdentityGate,
} from './cloudAuth';
import { CloudControlPlaneTransport, CloudJsonObject, CloudRawResponse } from './cloudProtocol';
import { CLOUD_ROUTES } from './cloudPolicy';

interface ExpectedPost {
    route: string;
    body: CloudJsonObject;
    accessToken?: string;
    response: CloudRawResponse;
}

class FakeTransport implements CloudControlPlaneTransport {
    readonly calls: string[] = [];

    constructor(private readonly expectedPosts: ExpectedPost[]) {}

    async bootstrapCsrf(): Promise<void> {
        this.calls.push('csrf');
    }

    async post(
        route: string,
        body: CloudJsonObject,
        options?: { accessToken?: string },
    ): Promise<CloudRawResponse> {
        this.calls.push(route);
        const expected = this.expectedPosts.shift();
        expect(expected?.route).toBe(route);
        expect(body).toEqual(expected?.body);
        expect(options?.accessToken).toBe(expected?.accessToken);
        if (!expected) throw new Error(`Unexpected request to ${route}`);
        return expected.response;
    }
}

const credentials = { email: 'test@example.com', password: '00000000' };
const randomCode = '12345678';
const derivedPassword = '4d7b223baa98f7cbaf870e309a1335e4b538bb56e3a4604575917fdd45c3ec0e';

function successfulPosts(accountId = '9223372036854775807', quoteAccountId = false): ExpectedPost[] {
    return [
        {
            route: CLOUD_ROUTES.loginNonce,
            body: { account: credentials.email, countryCode: '1' },
            response: {
                status: 200,
                body: `{"success":true,"randomCode":"${randomCode}","timestamp":1720000000000}`,
            },
        },
        {
            route: CLOUD_ROUTES.passwordLogin,
            body: {
                account: credentials.email,
                password: derivedPassword,
                countryCode: 1,
                browser: 'Chrome107',
                equipment: '1',
                loginMethod: '1',
                language: 'en',
                timestamp: 1720000000000,
            },
            response: { status: 200, body: '{"success":true,"token":"session-token"}' },
        },
        {
            route: CLOUD_ROUTES.accountIdentity,
            body: {},
            accessToken: 'session-token',
            response: {
                status: 200,
                body: `{"success":true,"userId":${quoteAccountId ? `"${accountId}"` : accountId}}`,
            },
        },
    ];
}

function verificationPosts(accountId = '9223372036854775807'): ExpectedPost[] {
    const posts = successfulPosts(accountId);
    posts[1].response = { status: 200, body: '{"success":false,"errorCode":"E1760"}' };
    posts.splice(2, 0,
        {
            route: CLOUD_ROUTES.verificationPreAuth,
            body: { account: credentials.email },
            response: { status: 200, body: '{"success":true,"token":"zero-signing-key-two-1"}' },
        },
        {
            route: CLOUD_ROUTES.verificationSend,
            body: {
                email: credentials.email,
                timestamp: 1720000000000,
                token: 'zero-signing-key-two-1',
                sign: deriveCloudVerificationSign(credentials.email, 'signing'),
            },
            response: { status: 200, body: '{"success":true,"validCodeKey":"valid-code-key"}' },
        },
        {
            route: CLOUD_ROUTES.verificationLogin,
            body: {
                email: credentials.email,
                validCode: '654321',
                validCodeKey: 'valid-code-key',
                timestamp: 1720000000000,
                browser: 'Chrome107',
                equipment: '4',
            },
            response: { status: 200, body: '{"success":true}' },
        },
        {
            route: CLOUD_ROUTES.queryToken,
            body: {},
            response: { status: 200, body: '{"success":true,"token":"verified-session-token"}' },
        },
    );
    posts.at(-1)!.accessToken = 'verified-session-token';
    return posts;
}

describe('Cloud password authentication', () => {
    it('derives the compatible password hash without Node crypto', () => {
        expect(deriveCloudPassword(credentials.password, randomCode)).toBe(derivedPassword);
    });

    it('uses the exact candidate request shape and preserves an int64 account ID', async () => {
        const transport = new FakeTransport(successfulPosts());

        await expect(authenticateCloudPassword(transport, credentials)).resolves.toEqual({
            token: 'session-token',
            accountId: '9223372036854775807',
            emailVerificationUsed: false,
        });
        expect(transport.calls).toEqual([
            'csrf',
            CLOUD_ROUTES.loginNonce,
            CLOUD_ROUTES.passwordLogin,
            CLOUD_ROUTES.accountIdentity,
        ]);
    });

    it('keeps the email-code branch unavailable without an explicit code provider', async () => {
        const posts = successfulPosts();
        posts[1].response = { status: 200, body: '{"success":false,"errorCode":"E1760"}' };
        posts.splice(2, 1);
        const transport = new FakeTransport(posts);

        await expect(authenticateCloudPassword(transport, credentials))
            .rejects.toBeInstanceOf(CloudVerificationRequiredError);
        expect(transport.calls).not.toContain(CLOUD_ROUTES.accountIdentity);
    });

    it('completes email verification in the original cookie and CSRF session', async () => {
        const transport = new FakeTransport(verificationPosts());

        await expect(authenticateCloudPassword(transport, credentials, {
            getVerificationCode: async () => ' 654321 ',
        })).resolves.toEqual({
            token: 'verified-session-token',
            accountId: '9223372036854775807',
            emailVerificationUsed: true,
        });
        expect(transport.calls).toEqual([
            'csrf',
            CLOUD_ROUTES.loginNonce,
            CLOUD_ROUTES.passwordLogin,
            CLOUD_ROUTES.verificationPreAuth,
            CLOUD_ROUTES.verificationSend,
            CLOUD_ROUTES.verificationLogin,
            CLOUD_ROUTES.queryToken,
            CLOUD_ROUTES.accountIdentity,
        ]);
    });

    it('fails closed on malformed pre-auth tokens and rejected codes', async () => {
        const malformed = verificationPosts();
        malformed[2].response = { status: 200, body: '{"success":true,"token":"malformed"}' };
        await expect(authenticateCloudPassword(new FakeTransport(malformed), credentials, {
            getVerificationCode: async () => '654321',
        })).rejects.toThrow('invalid pre-auth token');

        const rejected = verificationPosts();
        rejected[4].response = { status: 200, body: '{"success":false,"errorCode":"E1756"}' };
        rejected.splice(5);
        await expect(authenticateCloudPassword(new FakeTransport(rejected), credentials, {
            getVerificationCode: async () => '654321',
        })).rejects.toBeInstanceOf(CloudVerificationCodeRejectedError);
    });

    it('fails closed on malformed envelopes and noncanonical account IDs', async () => {
        const malformed = successfulPosts();
        malformed[0].response = { status: 200, body: '{"randomCode":"12345678"}' };
        await expect(authenticateCloudPassword(new FakeTransport(malformed), credentials))
            .rejects.toThrow('boolean success');

        const noncanonical = successfulPosts('01', true);
        await expect(authenticateCloudPassword(new FakeTransport(noncanonical), credentials))
            .rejects.toThrow('invalid userId');
    });

    it('requires the same account identity from two fresh sessions', async () => {
        const transports = [
            new FakeTransport(successfulPosts('9223372036854775807')),
            new FakeTransport(successfulPosts('9223372036854775806')),
        ];

        await expect(verifyCloudAuthIdentityGate(() => transports.shift()!, credentials))
            .rejects.toThrow('different account identities');
    });
});