import { CookieJar } from 'tough-cookie';
import {
    CloudControlPlaneTransport,
    CloudJsonObject,
    CloudProtocolError,
    CloudRawResponse,
    parseCloudObject,
} from '../src/cloudSync/cloudProtocol';
import { CloudFieldEvidence, CloudObservedJsonType, CloudRequestEvidence } from '../src/cloudSync/cloudProtocolEvidence';
import {
    CLOUD_AUTH_IDENTITY_REQUEST_LIMIT,
    CLOUD_CONTROL_PLANE_TIMEOUT_MS,
    CLOUD_PRODUCTION_ORIGIN,
    CLOUD_ROUTES,
} from '../src/cloudSync/cloudPolicy';

const AUTH_IDENTITY_ROUTES = new Set<string>([
    CLOUD_ROUTES.csrf,
    CLOUD_ROUTES.loginNonce,
    CLOUD_ROUTES.passwordLogin,
    CLOUD_ROUTES.verificationPreAuth,
    CLOUD_ROUTES.verificationSend,
    CLOUD_ROUTES.verificationLogin,
    CLOUD_ROUTES.queryToken,
    CLOUD_ROUTES.accountIdentity,
    CLOUD_ROUTES.directoryList,
    CLOUD_ROUTES.pathQuery,
]);
const FIXED_VALUE_FIELDS = new Set(['browser', 'countryCode', 'equipment', 'language', 'loginMethod']);

export class CloudRequestBudget {
    private used = 0;

    constructor(private readonly maximum = CLOUD_AUTH_IDENTITY_REQUEST_LIMIT) {}

    take(): void {
        this.used++;
        if (this.used > this.maximum) {
            throw new CloudProtocolError(`Cloud protocol request limit exceeded (${this.maximum})`);
        }
    }
}

export interface NodeCloudProtocolTransportOptions {
    session: string;
    budget: CloudRequestBudget;
    origin?: string;
    fetchImplementation?: typeof fetch;
}

export class NodeCloudProtocolTransport implements CloudControlPlaneTransport {
    readonly evidence: CloudRequestEvidence[] = [];

    private readonly jar = new CookieJar();
    private readonly origin: string;
    private readonly fetchImplementation: typeof fetch;
    private csrfToken: string | null = null;
    private csrfSource: 'cookie' | 'header' | 'none' = 'none';

    constructor(private readonly options: NodeCloudProtocolTransportOptions) {
        const origin = new URL(options.origin ?? CLOUD_PRODUCTION_ORIGIN);
        if (origin.protocol !== 'https:' || origin.username || origin.password) {
            throw new CloudProtocolError('Cloud protocol origin must be credential-free HTTPS');
        }
        this.origin = origin.origin;
        this.fetchImplementation = options.fetchImplementation ?? fetch;
    }

    async bootstrapCsrf(): Promise<void> {
        const response = await this.send(CLOUD_ROUTES.csrf, { method: 'GET' });
        if (!this.csrfToken) {
            throw new CloudProtocolError('Supernote Cloud did not provide CSRF state');
        }

        this.evidence.push(await this.buildEvidence('GET', CLOUD_ROUTES.csrf, response, {}, false));
    }

    async post(
        route: string,
        body: CloudJsonObject,
        options?: { accessToken?: string },
    ): Promise<CloudRawResponse> {
        let response = await this.send(route, {
            method: 'POST',
            body,
            accessToken: options?.accessToken,
        });
        this.evidence.push(await this.buildEvidence('POST', route, response, body, Boolean(options?.accessToken)));

        if (response.status === 403) {
            await this.bootstrapCsrf();
            response = await this.send(route, {
                method: 'POST',
                body,
                accessToken: options?.accessToken,
            });
            this.evidence.push(await this.buildEvidence('POST', route, response, body, Boolean(options?.accessToken)));
        }

        return { status: response.status, body: await response.text() };
    }

    private async send(
        route: string,
        request: { method: 'GET' | 'POST'; body?: CloudJsonObject; accessToken?: string },
    ): Promise<Response> {
        if (!AUTH_IDENTITY_ROUTES.has(route)) {
            throw new CloudProtocolError(`Cloud protocol route is not allowed in this harness milestone: ${route}`);
        }
        this.options.budget.take();

        const url = new URL(route, this.origin);
        if (url.origin !== this.origin) throw new CloudProtocolError('Cloud protocol route changed the request origin');

        const headers = new Headers({
            Accept: 'application/json',
            'User-Agent': 'obsidian-supernote-companion-cloud-protocol-harness',
        });
        const cookie = await this.jar.getCookieString(url.href);
        if (cookie) headers.set('Cookie', cookie);
        if (this.csrfToken) headers.set('X-XSRF-TOKEN', this.csrfToken);
        if (request.accessToken) headers.set('x-access-token', request.accessToken);
        if (request.body) headers.set('Content-Type', 'application/json');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CLOUD_CONTROL_PLANE_TIMEOUT_MS);
        let response: Response;
        try {
            response = await this.fetchImplementation(url, {
                method: request.method,
                headers,
                body: request.body ? JSON.stringify(request.body) : undefined,
                redirect: 'manual',
                signal: controller.signal,
            });
        } catch (error) {
            const message = error instanceof Error && error.name === 'AbortError'
                ? 'Supernote Cloud request timed out'
                : 'Supernote Cloud request failed';
            throw new CloudProtocolError(message);
        } finally {
            clearTimeout(timeout);
        }

        if (response.status >= 300 && response.status < 400) {
            throw new CloudProtocolError('Supernote Cloud control-plane redirect was rejected');
        }
        await this.storeResponseCookies(response, url.href);
        await this.updateCsrfState(response);
        return response;
    }

    private async storeResponseCookies(response: Response, requestUrl: string): Promise<void> {
        const headers = response.headers as Headers & { getSetCookie?: () => string[] };
        const setCookies = headers.getSetCookie?.() ?? [];
        if (setCookies.length === 0 && response.headers.has('set-cookie')) {
            throw new CloudProtocolError('Runtime cannot safely classify multiple Set-Cookie headers');
        }
        for (const setCookie of setCookies) {
            try {
                await this.jar.setCookie(setCookie, requestUrl);
            } catch {
                throw new CloudProtocolError('Supernote Cloud returned an invalid cookie');
            }
        }
    }

    private async updateCsrfState(response: Response): Promise<void> {
        const headerToken = response.headers.get('x-xsrf-token');
        if (headerToken) {
            this.csrfToken = headerToken;
            this.csrfSource = 'header';
            return;
        }

        const cookies = await this.jar.getCookies(this.origin);
        const cookieToken = cookies.find((cookie) => cookie.key.toUpperCase() === 'XSRF-TOKEN')?.value;
        if (cookieToken) {
            this.csrfToken = decodeCookieValue(cookieToken);
            this.csrfSource = 'cookie';
        }
    }

    private async buildEvidence(
        method: 'GET' | 'POST',
        route: string,
        response: Response,
        body: CloudJsonObject,
        accessTokenSent: boolean,
    ): Promise<CloudRequestEvidence> {
        const responseFields = response.status === 200 && route !== CLOUD_ROUTES.csrf
            ? describeResponseFields(await response.clone().text(), response.status)
            : [];
        const cookies = await this.jar.getCookies(this.origin);
        return {
            session: this.options.session,
            method,
            route,
            status: response.status,
            requestFields: describeRequestFields(body),
            responseFields,
            cookieNames: cookies.map((cookie) => cookie.key).sort(),
            csrfSource: this.csrfSource,
            accessTokenSent,
        };
    }
}

function describeResponseFields(body: string, status: number): CloudFieldEvidence[] {
    const parsed = parseCloudObject({ status, body });
    return Object.entries(parsed)
        .map(([name, value]) => ({ name, type: observedType(value) }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

function describeRequestFields(body: CloudJsonObject): CloudFieldEvidence[] {
    return Object.entries(body)
        .map(([name, value]) => ({
            name,
            type: observedType(value),
            ...(FIXED_VALUE_FIELDS.has(name) && isFixedValue(value) ? { fixedValue: value } : {}),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

function observedType(value: unknown): CloudObservedJsonType {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    if (typeof value === 'boolean' || typeof value === 'string') return value === true || value === false ? 'boolean' : 'string';
    return 'object';
}

function isFixedValue(value: unknown): value is string | number | boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function decodeCookieValue(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        throw new CloudProtocolError('Supernote Cloud returned an invalid CSRF cookie');
    }
}