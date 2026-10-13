export type CloudObservedJsonType = 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string';

export interface CloudFieldEvidence {
    name: string;
    type: CloudObservedJsonType;
    fixedValue?: string | number | boolean;
}

export interface CloudRequestEvidence {
    session: string;
    method: 'GET' | 'POST';
    route: string;
    status: number;
    requestFields: CloudFieldEvidence[];
    responseFields: CloudFieldEvidence[];
    cookieNames: string[];
    csrfSource: 'cookie' | 'header' | 'none';
    accessTokenSent: boolean;
}

export interface CloudAuthIdentityObservation {
    date: string;
    origin: string;
    harnessCommit: string;
    cloudImplementationCommit: string;
    accountIdentityHash: string;
    emailVerificationUsed: boolean;
    requests: CloudRequestEvidence[];
}

export interface CloudInventoryObservation {
    date: string;
    origin: string;
    harnessCommit: string;
    cloudImplementationCommit: string;
    sessionSource: 'environment' | 'temporary-file' | 'fresh-login';
    accountIdentityHash: string;
    directoryCount: number;
    itemCount: number;
    fileCount: number;
    folderCount: number;
    maximumObservedPageCount: number;
    secondPageObserved: boolean;
    firstInventoryFingerprint: string;
    secondInventoryFingerprint: string;
    inventoryStable: boolean;
    pathQueryCount: number;
    pathMatchesParent: number;
    pathMatchesItem: number;
    pathMatchesNeither: number;
    allQueryPathsAbsolute: boolean;
    allQueryPathsTrailingSlash: boolean;
    allIdPathsAbsolute: boolean;
    allIdPathsTrailingSlash: boolean;
    requests: CloudRequestEvidence[];
}

// These reports intentionally retain aggregate shape and redacted request
// metadata only. Never add filenames, paths, remote IDs, bodies, or credentials
// here: a protocol observation should be useful without becoming account data.
export function formatCloudAuthIdentityObservation(observation: CloudAuthIdentityObservation): string {
    const lines = [
        '# Supernote Cloud Protocol Observation',
        '',
        `- Test date: ${observation.date}`,
        `- Production origin: ${observation.origin}`,
        `- Harness commit: ${observation.harnessCommit}`,
        `- Cloud implementation commit: ${observation.cloudImplementationCommit}`,
        '- Password sign-in gate: pass',
        `- Email verification gate: ${observation.emailVerificationUsed ? 'pass' : 'not required by tested account'}`,
        '- Account identity gate: pass',
        `- Per-run account identity hash: ${observation.accountIdentityHash}`,
        '',
        '| Session | Method | Route | HTTP | Request fields | Response fields | Cookie names | CSRF | Access token |',
        '| --- | --- | --- | ---: | --- | --- | --- | --- | --- |',
    ];

    for (const request of observation.requests) {
        lines.push([
            request.session,
            request.method,
            request.route,
            String(request.status),
            formatFields(request.requestFields),
            formatFields(request.responseFields),
            request.cookieNames.join(', ') || 'none',
            request.csrfSource,
            request.accessTokenSent ? 'yes' : 'no',
        ].map(escapeTableCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }

    return `${lines.join('\n')}\n`;
}

export function formatCloudInventoryObservation(observation: CloudInventoryObservation): string {
    const paginationStatus = observation.secondPageObserved
        ? 'pass'
        : 'incomplete fixture: no second page was observed';
    const pathStatus = observation.pathQueryCount > 0 && observation.pathMatchesNeither === 0
        ? 'partial: observed paths matched listed item or parent paths'
        : 'unresolved';
    const lines = [
        '# Supernote Cloud Inventory Observation',
        '',
        `- Test date: ${observation.date}`,
        `- Production origin: ${observation.origin}`,
        `- Harness commit: ${observation.harnessCommit}`,
        `- Cloud implementation commit: ${observation.cloudImplementationCommit}`,
        `- Session source: ${observation.sessionSource}`,
        `- Account identity hash: ${observation.accountIdentityHash}`,
        `- Inventory response-shape gate: ${paginationStatus}`,
        `- Inventory stability: ${observation.inventoryStable ? 'pass' : 'fail'}`,
        `- Canonical-path gate: ${pathStatus}`,
        '',
        '## Aggregate Evidence',
        '',
        `- Directories listed: ${observation.directoryCount}`,
        `- Items: ${observation.itemCount}`,
        `- Files: ${observation.fileCount}`,
        `- Folders: ${observation.folderCount}`,
        `- Maximum observed page count: ${observation.maximumObservedPageCount}`,
        `- First inventory fingerprint: ${observation.firstInventoryFingerprint}`,
        `- Second inventory fingerprint: ${observation.secondInventoryFingerprint}`,
        `- Path queries: ${observation.pathQueryCount}`,
        `- Query path matched listed parent: ${observation.pathMatchesParent}`,
        `- Query path matched listed item: ${observation.pathMatchesItem}`,
        `- Query path matched neither: ${observation.pathMatchesNeither}`,
        `- All query paths absolute: ${yesNo(observation.allQueryPathsAbsolute)}`,
        `- All query paths trailing-slash-terminated: ${yesNo(observation.allQueryPathsTrailingSlash)}`,
        `- All ID paths absolute: ${yesNo(observation.allIdPathsAbsolute)}`,
        `- All ID paths trailing-slash-terminated: ${yesNo(observation.allIdPathsTrailingSlash)}`,
        '',
        'No account paths, filenames, remote identifiers, credentials, token values, cookies, or response bodies are retained.',
        '',
        '| Session | Method | Route | HTTP | Request fields | Response fields | Cookie names | CSRF | Access token |',
        '| --- | --- | --- | ---: | --- | --- | --- | --- | --- |',
    ];

    appendRequestEvidence(lines, observation.requests);
    return `${lines.join('\n')}\n`;
}

function formatFields(fields: CloudFieldEvidence[]): string {
    return fields.map((field) => {
        const fixedValue = field.fixedValue === undefined ? '' : `=${JSON.stringify(field.fixedValue)}`;
        return `${field.name}:${field.type}${fixedValue}`;
    }).join(', ') || 'none';
}

function escapeTableCell(value: string): string {
    return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function appendRequestEvidence(lines: string[], requests: CloudRequestEvidence[]): void {
    for (const request of requests) {
        lines.push([
            request.session,
            request.method,
            request.route,
            String(request.status),
            formatFields(request.requestFields),
            formatFields(request.responseFields),
            request.cookieNames.join(', ') || 'none',
            request.csrfSource,
            request.accessTokenSent ? 'yes' : 'no',
        ].map(escapeTableCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
}

function yesNo(value: boolean): string {
    return value ? 'yes' : 'no';
}