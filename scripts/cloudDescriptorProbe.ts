import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { CloudControlPlaneTransport, CloudProtocolError, CloudRawResponse, parseCloudObject, requireCloudSuccess, requireNonEmptyString } from '../src/sync/supernoteCloud/cloudProtocol';
import { CLOUD_MAX_DESKTOP_FILE_BYTES, CLOUD_PRODUCTION_ORIGIN, CLOUD_ROUTES } from '../src/sync/supernoteCloud/cloudPolicy';
import { downloadCloudBytes } from '../src/sync/supernoteCloud/cloudDownload';

export async function probeCloudDownloadDescriptor(
    transport: CloudControlPlaneTransport,
    accessToken: string,
    fileId: string,
): Promise<{ scheme: 'https' | 'http' | 'other'; hostClass: 'cloud-origin' | 'other'; md5FormatValid: boolean }> {
    if (!/^(0|[1-9]\d*)$/.test(fileId)) throw new CloudProtocolError('Invalid Cloud fixture ID');
    const response = parseCloudObject(await transport.post(
        CLOUD_ROUTES.downloadDescriptor, { id: fileId, type: '0' }, { accessToken },
    ));
    requireCloudSuccess(response);
    const rawUrl = requireNonEmptyString(response, 'url');
    const md5 = requireNonEmptyString(response, 'md5');
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new CloudProtocolError('Cloud download descriptor URL is invalid');
    }
    return {
        scheme: url.protocol === 'https:' ? 'https' : url.protocol === 'http:' ? 'http' : 'other',
        hostClass: url.origin === CLOUD_PRODUCTION_ORIGIN ? 'cloud-origin' : 'other',
        md5FormatValid: /^[a-f\d]{32}$/i.test(md5),
    };
}

export function inspectCloudDescriptorHost(response: CloudRawResponse): string {
    const parsed = parseCloudObject(response);
    requireCloudSuccess(parsed);
    let url: URL;
    try {
        url = new URL(requireNonEmptyString(parsed, 'url'));
    } catch {
        throw new CloudProtocolError('Cloud download descriptor URL is invalid');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !/^[a-z0-9.-]+$/.test(url.hostname)
        || /^\d+(?:\.\d+){3}$/.test(url.hostname)
        || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
        throw new CloudProtocolError('Cloud download descriptor host cannot be reviewed safely');
    }
    return url.hostname;
}

export async function verifyCloudFixtureDownload(
    transport: CloudControlPlaneTransport,
    accessToken: string,
    fileId: string,
    expectedSize: number,
    expectedMd5: string,
    approvedHost: string,
    request: (options: RequestUrlParam) => Promise<Pick<RequestUrlResponse, 'status' | 'arrayBuffer'>>,
): Promise<{ sizeVerified: true; md5Verified: true }> {
    if (!/^(0|[1-9]\d*)$/.test(fileId)
        || !Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > CLOUD_MAX_DESKTOP_FILE_BYTES
        || !/^[a-f\d]{32}$/i.test(expectedMd5)
        || !/^[a-z0-9.-]+$/.test(approvedHost)) {
        throw new CloudProtocolError('Invalid fixture metadata or approved host');
    }
    const descriptor = await transport.post(CLOUD_ROUTES.downloadDescriptor,
        { id: fileId, type: '0' }, { accessToken });
    if (inspectCloudDescriptorHost(descriptor) !== approvedHost) {
        throw new CloudProtocolError('Cloud descriptor host differs from the reviewed host');
    }
    const bytes = await downloadCloudBytes(descriptor, expectedMd5, expectedSize, request);
    if (bytes.length !== expectedSize
        || bytesToHex(md5(bytes)) !== expectedMd5.toLowerCase()) {
        throw new CloudProtocolError('Cloud fixture download failed size or MD5 verification');
    }
    return { sizeVerified: true, md5Verified: true };
}