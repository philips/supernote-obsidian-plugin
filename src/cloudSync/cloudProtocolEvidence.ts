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

function formatFields(fields: CloudFieldEvidence[]): string {
    return fields.map((field) => {
        const fixedValue = field.fixedValue === undefined ? '' : `=${JSON.stringify(field.fixedValue)}`;
        return `${field.name}:${field.type}${fixedValue}`;
    }).join(', ') || 'none';
}

function escapeTableCell(value: string): string {
    return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}