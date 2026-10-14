import process from 'node:process';
import { inspectCloudDescriptorHost, probeCloudDownloadDescriptor, verifyCloudFixtureDownload } from './cloudDescriptorProbe';
import { loadCloudProtocolSession, validateCloudProtocolSession } from './cloudProtocolSession';
import { CloudRequestBudget, NodeCloudProtocolTransport } from './cloudProtocolTransport';
import { CLOUD_PRODUCTION_ORIGIN, CLOUD_ROUTES } from '../src/cloudSync/cloudPolicy';
import { CloudProtocolError } from '../src/cloudSync/cloudProtocol';

// No mode logs in or persists responses; only fixture-transfer fetches bytes.
const hostReview = process.argv[2] === 'host-review';
const fixtureTransfer = process.argv[2] === 'fixture-transfer';
const acknowledgement = fixtureTransfer
    ? process.env.SUPERNOTE_CLOUD_TRANSFER_ACK === 'I_ACKNOWLEDGE_FIXTURE_TRANSFER'
    : hostReview ? process.env.SUPERNOTE_CLOUD_HOST_REVIEW_ACK === 'I_ACKNOWLEDGE_HOST_REVIEW'
        : process.env.SUPERNOTE_CLOUD_DESCRIPTOR_ACK === 'I_ACKNOWLEDGE_ONE_READ_ONLY_DESCRIPTOR_REQUEST';
if (!acknowledgement) {
    throw new CloudProtocolError('Explicit descriptor probe acknowledgement is required');
}
const fileId = process.env.SUPERNOTE_CLOUD_FIXTURE_FILE_ID;
if (!fileId || !/^(0|[1-9]\d*)$/.test(fileId)) {
    throw new CloudProtocolError('A canonical SUPERNOTE_CLOUD_FIXTURE_FILE_ID is required');
}
const fixtureSize = fixtureTransfer ? process.env.SUPERNOTE_CLOUD_FIXTURE_SIZE : undefined;
const fixtureMd5 = fixtureTransfer ? process.env.SUPERNOTE_CLOUD_FIXTURE_MD5 : undefined;
if (fixtureTransfer && (!fixtureSize || !/^[1-9]\d*$/.test(fixtureSize)
    || !Number.isSafeInteger(Number(fixtureSize)) || !fixtureMd5 || !/^[a-f\d]{32}$/i.test(fixtureMd5))) {
    throw new CloudProtocolError('Fixture transfer requires its listed size and MD5');
}
const session = await loadCloudProtocolSession(CLOUD_PRODUCTION_ORIGIN);
if (!session || !session.accountId) {
    throw new CloudProtocolError('A cached Cloud session with an account binding is required; no login was attempted');
}
const transport = new NodeCloudProtocolTransport({ session: 'descriptor-probe', budget: new CloudRequestBudget(4) });
const validated = await validateCloudProtocolSession(transport, session);
if (fixtureTransfer) {
    const result = await verifyCloudFixtureDownload(transport, validated.token, fileId,
        Number(fixtureSize), fixtureMd5!, 'usa-ratta-cloud.s3.us-west-1.amazonaws.com',
        async ({ url }) => {
            const response = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
            return { status: response.status, arrayBuffer: await response.arrayBuffer() };
        });
    process.stdout.write(`Disposable fixture: size verified=${result.sizeVerified}; MD5 verified=${result.md5Verified}.\n`);
    process.stdout.write('No file bytes were saved or written to the vault.\n');
} else if (hostReview) {
    const descriptor = await transport.post(CLOUD_ROUTES.downloadDescriptor,
        { id: fileId, type: '0' }, { accessToken: validated.token });
    process.stdout.write(`Reviewed descriptor hostname: ${inspectCloudDescriptorHost(descriptor)}\n`);
    process.stdout.write('No signed URL or file bytes were fetched or retained.\n');
} else {
    const summary = await probeCloudDownloadDescriptor(transport, validated.token, fileId);
    process.stdout.write(`Descriptor probe: scheme=${summary.scheme}; host class=${summary.hostClass}; MD5 format valid=${summary.md5FormatValid}.\n`);
    process.stdout.write('No signed URL or file bytes were fetched or retained.\n');
}