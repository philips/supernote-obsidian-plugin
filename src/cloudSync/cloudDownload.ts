import { CloudProtocolError, CloudRawResponse, parseCloudObject, requireCloudSuccess, requireNonEmptyString } from './cloudProtocol';

// Hosts must be independently reviewed before passing them here; an empty list
// deliberately disables transfers while production descriptor hosts are unknown.
export async function downloadCloudBytes(
    descriptorResponse: CloudRawResponse,
    expectedMd5: string,
    approvedHosts: ReadonlySet<string>,
    maxBytes: number,
    fetchImplementation: typeof fetch = fetch,
): Promise<Uint8Array> {
    const descriptor = parseCloudObject(descriptorResponse);
    requireCloudSuccess(descriptor);
    const descriptorMd5 = requireNonEmptyString(descriptor, 'md5');
    if (!/^[a-f\d]{32}$/i.test(expectedMd5) || descriptorMd5.toLowerCase() !== expectedMd5.toLowerCase()) {
        throw new CloudProtocolError('Cloud download descriptor checksum does not match inventory');
    }
    let url = requireNonEmptyString(descriptor, 'url');
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new CloudProtocolError('Invalid Cloud download size limit');
    }

    const deadline = Date.now() + 300_000;
    for (let redirects = 0; redirects <= 5; redirects++) {
        let target: URL;
        try {
            target = new URL(url);
        } catch {
            throw new CloudProtocolError('Invalid Cloud download URL');
        }
        if (target.protocol !== 'https:' || target.username || target.password || target.port
            || !approvedHosts.has(target.hostname)) {
            throw new CloudProtocolError('Unapproved Cloud download host or URL');
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new CloudProtocolError('Cloud download timed out');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), remaining);
        try {
            // No Cloud auth headers, cookies, or CSRF state are ever passed to a download host.
            const response = await fetchImplementation(target, {
                method: 'GET', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
            });
            if (response.status >= 300 && response.status < 400) {
                if (redirects === 5) throw new CloudProtocolError('Too many Cloud download redirects');
                const location = response.headers.get('location');
                if (!location) throw new CloudProtocolError('Cloud download redirect lacks a location');
                url = new URL(location, target).href;
                continue;
            }
            if (!response.ok || !response.body) throw new CloudProtocolError('Cloud download request failed');
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let length = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                if (length > maxBytes) {
                    await reader.cancel();
                    throw new CloudProtocolError('Cloud download exceeds size limit');
                }
                chunks.push(value);
            }
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            return bytes;
        } catch (error) {
            if (error instanceof CloudProtocolError) throw error;
            throw new CloudProtocolError('Cloud download request failed');
        } finally {
            clearTimeout(timeout);
        }
    }
    throw new CloudProtocolError('Too many Cloud download redirects');
}