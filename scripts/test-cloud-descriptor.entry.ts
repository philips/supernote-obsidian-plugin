import process from 'node:process';
import { probeCloudDownloadDescriptor } from './cloudDescriptorProbe';
import { loadCloudProtocolSession, validateCloudProtocolSession } from './cloudProtocolSession';
import { CloudRequestBudget, NodeCloudProtocolTransport } from './cloudProtocolTransport';
import { CLOUD_PRODUCTION_ORIGIN } from '../src/cloudSync/cloudPolicy';
import { CloudProtocolError } from '../src/cloudSync/cloudProtocol';

// This mode never logs in, lists files, fetches a signed URL, or stores a response.
if (process.env.SUPERNOTE_CLOUD_DESCRIPTOR_ACK !== 'I_ACKNOWLEDGE_ONE_READ_ONLY_DESCRIPTOR_REQUEST') {
    throw new CloudProtocolError('Explicit descriptor probe acknowledgement is required');
}
const fileId = process.env.SUPERNOTE_CLOUD_FIXTURE_FILE_ID;
if (!fileId || !/^(0|[1-9]\d*)$/.test(fileId)) {
    throw new CloudProtocolError('A canonical SUPERNOTE_CLOUD_FIXTURE_FILE_ID is required');
}
const session = await loadCloudProtocolSession(CLOUD_PRODUCTION_ORIGIN);
if (!session || !session.accountId) {
    throw new CloudProtocolError('A cached Cloud session with an account binding is required; no login was attempted');
}
const transport = new NodeCloudProtocolTransport({ session: 'descriptor-probe', budget: new CloudRequestBudget(4) });
const validated = await validateCloudProtocolSession(transport, session);
const summary = await probeCloudDownloadDescriptor(transport, validated.token, fileId);
process.stdout.write(`Descriptor probe: scheme=${summary.scheme}; host class=${summary.hostClass}; MD5 format valid=${summary.md5FormatValid}.\n`);
process.stdout.write('No signed URL or file bytes were fetched or retained.\n');