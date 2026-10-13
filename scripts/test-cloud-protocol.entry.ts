import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { verifyCloudAuthIdentityGate } from '../src/cloudSync/cloudAuth';
import { formatCloudAuthIdentityObservation } from '../src/cloudSync/cloudProtocolEvidence';
import { CLOUD_PRODUCTION_ORIGIN } from '../src/cloudSync/cloudPolicy';
import { CloudRequestBudget, NodeCloudProtocolTransport } from './cloudProtocolTransport';
import { promptForSecret } from './secretPrompt';

const acknowledgement = 'I_ACKNOWLEDGE_READ_ONLY_PRODUCTION_ACCESS';
if (process.env.SUPERNOTE_CLOUD_PROTOCOL_ACK !== acknowledgement) {
    throw new Error(`Set SUPERNOTE_CLOUD_PROTOCOL_ACK=${acknowledgement} to contact production.`);
}

const email = process.env.SUPERNOTE_CLOUD_EMAIL ?? await promptForSecret('Supernote Cloud email: ');
const password = process.env.SUPERNOTE_CLOUD_PASSWORD ?? await promptForSecret('Supernote Cloud password: ');
if (!email || !password) {
    throw new Error('A Supernote Cloud email and password are required for the dedicated test account.');
}

const budget = new CloudRequestBudget();
const transports: NodeCloudProtocolTransport[] = [];
const result = await verifyCloudAuthIdentityGate(() => {
    const transport = new NodeCloudProtocolTransport({
        session: `fresh-${transports.length + 1}`,
        budget,
    });
    transports.push(transport);
    return transport;
}, { email, password }, async (sessionNumber) => promptForSecret(
    `Email verification code for fresh session ${sessionNumber}: `,
));

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const accountIdentityHash = createHash('sha256')
    .update(randomBytes(32))
    .update(result.accountId, 'utf8')
    .digest('hex');

process.stdout.write(formatCloudAuthIdentityObservation({
    date: formatLocalDate(new Date()),
    origin: CLOUD_PRODUCTION_ORIGIN,
    harnessCommit: commit,
    cloudImplementationCommit: commit,
    accountIdentityHash,
    emailVerificationUsed: result.emailVerificationUsed,
    requests: transports.flatMap((transport) => transport.evidence),
}));

function formatLocalDate(date: Date): string {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}