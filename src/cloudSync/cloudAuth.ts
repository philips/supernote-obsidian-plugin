import { md5 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
    CloudControlPlaneTransport,
    CloudProtocolError,
    parseCloudObject,
    requireCanonicalDecimalId,
    requireCloudSuccess,
    requireNonEmptyString,
    requireSafeInteger,
} from './cloudProtocol';
import {
    CLOUD_PASSWORD_LOGIN_PROFILE,
    CLOUD_ROUTES,
    CLOUD_VERIFICATION_LOGIN_PROFILE,
} from './cloudPolicy';

export interface CloudCredentials {
    email: string;
    password: string;
}

export interface CloudAuthenticatedSession {
    token: string;
    accountId: string;
    emailVerificationUsed: boolean;
}

export interface CloudAuthenticationOptions {
    getVerificationCode?: () => Promise<string>;
}

export class CloudVerificationRequiredError extends CloudProtocolError {
    constructor() {
        super('Email verification is not yet supported by the verified Cloud protocol');
    }
}

export class CloudVerificationCodeRejectedError extends CloudProtocolError {
    constructor() {
        super('Supernote Cloud rejected or expired the email verification code');
    }
}

export function deriveCloudPassword(password: string, randomCode: string): string {
    const passwordMd5 = bytesToHex(md5(utf8ToBytes(password)));
    return bytesToHex(sha256(utf8ToBytes(passwordMd5 + randomCode)));
}

export function deriveCloudVerificationSign(email: string, signingKey: string): string {
    return bytesToHex(sha256(utf8ToBytes(email + signingKey)));
}

export async function authenticateCloudPassword(
    transport: CloudControlPlaneTransport,
    credentials: CloudCredentials,
    options: CloudAuthenticationOptions = {},
): Promise<CloudAuthenticatedSession> {
    await transport.bootstrapCsrf();

    const nonceResponse = parseCloudObject(await transport.post(CLOUD_ROUTES.loginNonce, {
        account: credentials.email,
        countryCode: '1',
    }));
    requireCloudSuccess(nonceResponse);
    const randomCode = requireNonEmptyString(nonceResponse, 'randomCode');
    const timestamp = requireSafeInteger(nonceResponse, 'timestamp');

    const loginResponse = parseCloudObject(await transport.post(CLOUD_ROUTES.passwordLogin, {
        account: credentials.email,
        password: deriveCloudPassword(credentials.password, randomCode),
        ...CLOUD_PASSWORD_LOGIN_PROFILE,
        timestamp,
    }));

    let emailVerificationUsed = false;
    let token: string;
    if (loginResponse.success === false && loginResponse.errorCode === 'E1760') {
        if (!options.getVerificationCode) throw new CloudVerificationRequiredError();
        token = await completeEmailVerification(
            transport,
            credentials.email,
            timestamp,
            options.getVerificationCode,
        );
        emailVerificationUsed = true;
    } else {
        requireCloudSuccess(loginResponse);
        token = requireNonEmptyString(loginResponse, 'token');
    }

    return {
        token,
        accountId: await queryCloudAccountIdentity(transport, token),
        emailVerificationUsed,
    };
}

export async function queryCloudAccountIdentity(
    transport: CloudControlPlaneTransport,
    accessToken: string,
): Promise<string> {
    const identityResponse = parseCloudObject(await transport.post(
        CLOUD_ROUTES.accountIdentity,
        {},
        { accessToken },
    ));
    requireCloudSuccess(identityResponse);
    return requireCanonicalDecimalId(identityResponse, 'userId');
}

export async function verifyCloudAuthIdentityGate(
    createTransport: () => CloudControlPlaneTransport,
    credentials: CloudCredentials,
    getVerificationCode?: (sessionNumber: number) => Promise<string>,
): Promise<{ token: string; accountId: string; emailVerificationUsed: boolean }> {
    const first = await authenticateCloudPassword(createTransport(), credentials, {
        getVerificationCode: getVerificationCode ? () => getVerificationCode(1) : undefined,
    });
    const second = await authenticateCloudPassword(createTransport(), credentials, {
        getVerificationCode: getVerificationCode ? () => getVerificationCode(2) : undefined,
    });
    if (first.accountId !== second.accountId) {
        throw new CloudProtocolError('Supernote Cloud returned different account identities across fresh sessions');
    }
    return {
        token: first.token,
        accountId: first.accountId,
        emailVerificationUsed: first.emailVerificationUsed || second.emailVerificationUsed,
    };
}

async function completeEmailVerification(
    transport: CloudControlPlaneTransport,
    email: string,
    timestamp: number,
    getVerificationCode: () => Promise<string>,
): Promise<string> {
    const preAuthResponse = parseCloudObject(await transport.post(CLOUD_ROUTES.verificationPreAuth, {
        account: email,
    }));
    requireCloudSuccess(preAuthResponse);
    const preAuthToken = requireNonEmptyString(preAuthResponse, 'token');
    const signingKey = extractVerificationSigningKey(preAuthToken);

    const sendResponse = parseCloudObject(await transport.post(CLOUD_ROUTES.verificationSend, {
        email,
        timestamp,
        token: preAuthToken,
        sign: deriveCloudVerificationSign(email, signingKey),
    }));
    requireCloudSuccess(sendResponse);
    const validCodeKey = requireNonEmptyString(sendResponse, 'validCodeKey');
    const verificationCode = validateVerificationCode(await getVerificationCode());

    const verificationResponse = parseCloudObject(await transport.post(CLOUD_ROUTES.verificationLogin, {
        email,
        validCode: verificationCode,
        validCodeKey,
        timestamp,
        ...CLOUD_VERIFICATION_LOGIN_PROFILE,
    }));
    if (
        verificationResponse.success === false
        && ['E1756', 'E0101', 'E1760'].includes(String(verificationResponse.errorCode))
    ) {
        throw new CloudVerificationCodeRejectedError();
    }
    requireCloudSuccess(verificationResponse);

    const tokenResponse = parseCloudObject(await transport.post(CLOUD_ROUTES.queryToken, {}));
    requireCloudSuccess(tokenResponse);
    return requireNonEmptyString(tokenResponse, 'token');
}

function extractVerificationSigningKey(token: string): string {
    const indexText = token.at(-1);
    if (!indexText || !/^\d$/.test(indexText)) {
        throw new CloudProtocolError('Supernote Cloud returned an invalid pre-auth token');
    }
    const signingKey = token.split('-')[Number(indexText)];
    if (!signingKey) throw new CloudProtocolError('Supernote Cloud returned an invalid pre-auth token');
    return signingKey;
}

function validateVerificationCode(code: string): string {
    const trimmed = code.trim();
    const hasControlCharacters = [...trimmed].some((character) => {
        const characterCode = character.charCodeAt(0);
        return characterCode <= 31 || characterCode === 127;
    });
    if (trimmed.length === 0 || trimmed.length > 64 || hasControlCharacters) {
        throw new CloudProtocolError('Email verification code is invalid');
    }
    return trimmed;
}