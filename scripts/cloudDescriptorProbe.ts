import { CloudControlPlaneTransport, CloudProtocolError, parseCloudObject, requireCloudSuccess, requireNonEmptyString } from '../src/cloudSync/cloudProtocol';
import { CLOUD_PRODUCTION_ORIGIN, CLOUD_ROUTES } from '../src/cloudSync/cloudPolicy';

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