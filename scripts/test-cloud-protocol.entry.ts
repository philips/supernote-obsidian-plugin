import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { authenticateCloudPassword } from '../src/cloudSync/cloudAuth';
import { collectCloudInventory, CloudInventoryItem, queryCloudPath } from '../src/cloudSync/cloudInventory';
import { CloudProtocolError } from '../src/cloudSync/cloudProtocol';
import { formatCloudInventoryObservation } from '../src/cloudSync/cloudProtocolEvidence';
import { CLOUD_PRODUCTION_ORIGIN } from '../src/cloudSync/cloudPolicy';
import { CloudRequestBudget, NodeCloudProtocolTransport } from './cloudProtocolTransport';
import {
    getCloudProtocolSessionPath,
    loadCloudProtocolSession,
    saveCloudProtocolSession,
    validateCloudProtocolSession,
} from './cloudProtocolSession';
import { promptForSecret } from './secretPrompt';

const acknowledgement = 'I_ACKNOWLEDGE_READ_ONLY_PRODUCTION_ACCESS';
const loginAcknowledgement = 'I_ACKNOWLEDGE_OTP_MAY_BE_SENT';
const maximumHarnessRequests = 5_000;
const maximumPathQueries = 256;
if (process.env.SUPERNOTE_CLOUD_PROTOCOL_ACK !== acknowledgement) {
    throw new Error(`Set SUPERNOTE_CLOUD_PROTOCOL_ACK=${acknowledgement} to contact production.`);
}

const budget = new CloudRequestBudget(maximumHarnessRequests);
const transports: NodeCloudProtocolTransport[] = [];
const createTransport = (session: string) => {
    const transport = new NodeCloudProtocolTransport({
        session,
        budget,
    });
    transports.push(transport);
    return transport;
};

const reusableSession = await loadCloudProtocolSession(CLOUD_PRODUCTION_ORIGIN);
let sessionSource: 'environment' | 'temporary-file' | 'fresh-login';
let token: string;
let accountId: string;
if (reusableSession) {
    sessionSource = reusableSession.source;
    try {
        ({ token, accountId } = await validateCloudProtocolSession(
            createTransport(`reuse-${reusableSession.source}`),
            reusableSession,
        ));
    } catch {
        throw new CloudProtocolError(
            'The reusable Cloud session could not be validated; no login or OTP request was attempted. '
            + `Replace the token or remove ${getCloudProtocolSessionPath()} before explicitly allowing login.`,
        );
    }
} else {
    if (process.env.SUPERNOTE_CLOUD_ALLOW_LOGIN !== loginAcknowledgement) {
        throw new CloudProtocolError(
            'No reusable Cloud session is available, and login was not attempted. '
            + `Set SUPERNOTE_CLOUD_ALLOW_LOGIN=${loginAcknowledgement} only when an OTP-capable login is acceptable.`,
        );
    }
    const email = process.env.SUPERNOTE_CLOUD_EMAIL ?? await promptForSecret('Supernote Cloud email: ');
    const password = process.env.SUPERNOTE_CLOUD_PASSWORD ?? await promptForSecret('Supernote Cloud password: ');
    if (!email || !password) {
        throw new CloudProtocolError('A Supernote Cloud email and password are required when login is explicitly enabled.');
    }
    const authenticated = await authenticateCloudPassword(
        createTransport('fresh-login'),
        { email, password },
        { getVerificationCode: async () => promptForSecret('Email verification code: ') },
    );
    sessionSource = 'fresh-login';
    token = authenticated.token;
    accountId = authenticated.accountId;
    await saveCloudProtocolSession(CLOUD_PRODUCTION_ORIGIN, token, accountId);
}

const firstInventoryTransport = createTransport('inventory-pass-1');
await firstInventoryTransport.bootstrapCsrf();
const firstInventory = await collectCloudInventory(firstInventoryTransport, token);
const secondInventoryTransport = createTransport('inventory-pass-2');
await secondInventoryTransport.bootstrapCsrf();
const secondInventory = await collectCloudInventory(secondInventoryTransport, token);
if (firstInventory.items.length > maximumPathQueries) {
    throw new CloudProtocolError(`Cloud protocol path-query limit exceeded (${maximumPathQueries})`);
}

const pathRelations = { parent: 0, item: 0, neither: 0 };
let allQueryPathsAbsolute = true;
let allQueryPathsTrailingSlash = true;
let allIdPathsAbsolute = true;
let allIdPathsTrailingSlash = true;
const pathTransport = createTransport('path-query');
await pathTransport.bootstrapCsrf();
for (const item of firstInventory.items) {
    const result = await queryCloudPath(pathTransport, token, item.id);
    const relation = classifyPathRelation(item, result.path);
    pathRelations[relation]++;
    allQueryPathsAbsolute &&= result.path.startsWith('/');
    allQueryPathsTrailingSlash &&= result.path.endsWith('/');
    allIdPathsAbsolute &&= result.idPath.startsWith('/');
    allIdPathsTrailingSlash &&= result.idPath.endsWith('/');
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const observationSalt = randomBytes(32);
const accountIdentityHash = createHash('sha256')
    .update(observationSalt)
    .update(accountId, 'utf8')
    .digest('hex');
const firstInventoryFingerprint = fingerprintInventory(firstInventory.items, observationSalt);
const secondInventoryFingerprint = fingerprintInventory(secondInventory.items, observationSalt);

process.stdout.write(formatCloudInventoryObservation({
    date: formatLocalDate(new Date()),
    origin: CLOUD_PRODUCTION_ORIGIN,
    harnessCommit: commit,
    cloudImplementationCommit: commit,
    sessionSource,
    accountIdentityHash,
    directoryCount: firstInventory.directories.length,
    itemCount: firstInventory.items.length,
    fileCount: firstInventory.items.filter((item) => !item.isFolder).length,
    folderCount: firstInventory.items.filter((item) => item.isFolder).length,
    maximumObservedPageCount: Math.max(0, ...firstInventory.directories.map((directory) => directory.pageCount)),
    secondPageObserved: firstInventory.directories.some((directory) => directory.pageCount >= 2),
    firstInventoryFingerprint,
    secondInventoryFingerprint,
    inventoryStable: firstInventoryFingerprint === secondInventoryFingerprint,
    pathQueryCount: firstInventory.items.length,
    pathMatchesParent: pathRelations.parent,
    pathMatchesItem: pathRelations.item,
    pathMatchesNeither: pathRelations.neither,
    allQueryPathsAbsolute,
    allQueryPathsTrailingSlash,
    allIdPathsAbsolute,
    allIdPathsTrailingSlash,
    requests: transports.flatMap((transport) => transport.evidence),
}));

function fingerprintInventory(items: CloudInventoryItem[], salt: Uint8Array): string {
    const hash = createHash('sha256').update(salt);
    for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) {
        hash.update(JSON.stringify([
            item.id,
            item.directoryId,
            item.parentDerivedPath,
            item.isFolder,
            item.size,
            item.md5,
        ]));
    }
    return hash.digest('hex');
}

function classifyPathRelation(item: CloudInventoryItem, queryPath: string): 'parent' | 'item' | 'neither' {
    const normalizedQueryPath = trimTrailingSlash(queryPath.normalize('NFC'));
    if (normalizedQueryPath === trimTrailingSlash(item.parentPath)) return 'parent';
    if (normalizedQueryPath === trimTrailingSlash(item.parentDerivedPath)) return 'item';
    return 'neither';
}

function trimTrailingSlash(path: string): string {
    return path === '/' ? path : path.replace(/\/+$/, '');
}

function formatLocalDate(date: Date): string {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}