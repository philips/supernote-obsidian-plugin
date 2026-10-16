import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import { CloudProtocolError, CloudRawResponse, parseCloudObject, requireCloudSuccess, requireNonEmptyString } from './cloudProtocol';

type BinaryRequest = (request: RequestUrlParam) => Promise<Pick<RequestUrlResponse, 'status' | 'arrayBuffer'>>;

export async function downloadCloudBytes(
    descriptorResponse: CloudRawResponse,
    expectedMd5: string,
    maxBytes: number,
    request: BinaryRequest = requestUrl,
): Promise<Uint8Array> {
    const descriptor = parseCloudObject(descriptorResponse);
    requireCloudSuccess(descriptor);
    const descriptorMd5 = requireNonEmptyString(descriptor, 'md5');
    if (!/^[a-f\d]{32}$/i.test(expectedMd5) || descriptorMd5.toLowerCase() !== expectedMd5.toLowerCase()) {
        throw new CloudProtocolError('Cloud download descriptor checksum does not match inventory');
    }
    const url = requireNonEmptyString(descriptor, 'url');
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new CloudProtocolError('Invalid Cloud download size limit');
    }
    let response: Pick<RequestUrlResponse, 'status' | 'arrayBuffer'>;
    try {
        response = await request({ url, method: 'GET', throw: false });
    } catch {
        throw new CloudProtocolError('Cloud download request failed');
    }
    if (response.status < 200 || response.status >= 300) throw new CloudProtocolError('Cloud download request failed');
    if (response.arrayBuffer.byteLength > maxBytes) throw new CloudProtocolError('Cloud download exceeds size limit');
    return new Uint8Array(response.arrayBuffer);
}