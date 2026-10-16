import JSONBig from 'json-bigint';

// Cloud IDs arrive as int64 JSON numbers. Parsing through native JSON would
// round values above Number.MAX_SAFE_INTEGER before validation can see them.
const losslessJson = JSONBig({
    alwaysParseAsBig: true,
    useNativeBigInt: true,
    protoAction: 'error',
    constructorAction: 'error',
});

export type CloudJsonObject = Record<string, unknown>;

export interface CloudRawResponse {
    status: number;
    body: string;
}

export interface CloudControlPlaneTransport {
    bootstrapCsrf(): Promise<void>;
    post(
        route: string,
        body: CloudJsonObject,
        options?: { accessToken?: string },
    ): Promise<CloudRawResponse>;
}

export class CloudProtocolError extends Error {}

export function parseCloudObject(response: CloudRawResponse): CloudJsonObject {
    if (response.status !== 200) {
        throw new CloudProtocolError(`Supernote Cloud request failed (HTTP ${response.status})`);
    }

    let parsed: unknown;
    try {
        parsed = losslessJson.parse(response.body) as unknown;
    } catch {
        throw new CloudProtocolError('Supernote Cloud returned malformed JSON');
    }

    if (!isCloudJsonObject(parsed)) {
        throw new CloudProtocolError('Supernote Cloud returned an invalid response object');
    }
    if (typeof parsed.success !== 'boolean') {
        throw new CloudProtocolError('Supernote Cloud response is missing a boolean success field');
    }
    return parsed;
}

export function requireCloudSuccess(response: CloudJsonObject): void {
    if (response.success === true) return;
    const code = typeof response.errorCode === 'string' && response.errorCode.length > 0
        ? ` ${response.errorCode}`
        : '';
    throw new CloudProtocolError(`Supernote Cloud error${code}`);
}

export function requireNonEmptyString(response: CloudJsonObject, field: string): string {
    const value = response[field];
    if (typeof value !== 'string' || value.length === 0) {
        throw new CloudProtocolError(`Supernote Cloud response has an invalid ${field} field`);
    }
    return value;
}

export function requireSafeInteger(response: CloudJsonObject, field: string): number {
    const value = response[field];
    if (typeof value !== 'bigint' || value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
        const type = value === undefined ? 'missing' : value === null ? 'null'
            : Array.isArray(value) ? 'array' : typeof value;
        throw new CloudProtocolError(`Supernote Cloud response has an invalid ${field} field (type: ${type})`);
    }
    const parsed = Number(value);
    return parsed;
}

export function requireCanonicalDecimalId(response: CloudJsonObject, field: string): string {
    const value = response[field];
    // Keep identifiers opaque strings; converting them to number (or doing
    // arithmetic on them) can merge distinct remote objects through rounding.
    if (typeof value === 'bigint' && value >= BigInt(0)) return value.toString(10);
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
        throw new CloudProtocolError(`Supernote Cloud response has an invalid ${field} field`);
    }
    return value;
}

function isCloudJsonObject(value: unknown): value is CloudJsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}