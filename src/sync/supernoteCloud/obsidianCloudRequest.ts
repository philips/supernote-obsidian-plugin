import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';

type CloudRequestUrl = (
    request: RequestUrlParam,
) => Promise<Pick<RequestUrlResponse, 'status' | 'headers' | 'text'>>;

export function createObsidianCloudRequest(
    request: CloudRequestUrl = requestUrl,
): typeof fetch {
    return async (input, init) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        const body = init?.body;
        if (body !== undefined && typeof body !== 'string' && !(body instanceof ArrayBuffer)) {
            throw new TypeError('Cloud request body must be a string or ArrayBuffer');
        }
        const options: RequestUrlParam = {
            url,
            method: init?.method,
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            body,
            throw: false,
        };
        const signal = init?.signal;
        let onAbort: (() => void) | undefined;
        try {
            const requestPromise = request(options);
            const response = signal
                ? await Promise.race([
                    requestPromise,
                    new Promise<never>((_resolve, reject) => {
                        onAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'));
                        if (signal.aborted) onAbort();
                        else signal.addEventListener('abort', onAbort, { once: true });
                    }),
                ])
                : await requestPromise;
            const noBodyStatus = response.status === 204 || response.status === 205 || response.status === 304;
            return new Response(noBodyStatus ? null : response.text, {
                status: response.status,
                headers: response.headers,
            });
        } finally {
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        }
    };
}