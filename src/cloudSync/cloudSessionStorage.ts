import type { App } from 'obsidian';

const TOKEN_SECRET_ID = 'supernote-cloud-access-token';
const ACCOUNT_SECRET_ID = 'supernote-cloud-account-id';

export interface CloudSession {
    token: string;
    accountId: string;
}

export class CloudSessionStorage {
    constructor(private readonly secrets: App['secretStorage']) {}

    load(): CloudSession | null {
        const token = this.secrets.getSecret(TOKEN_SECRET_ID);
        const accountId = this.secrets.getSecret(ACCOUNT_SECRET_ID);
        if (token === null && accountId === null) return null;
        if (!token || !accountId || !/^(0|[1-9]\d*)$/.test(accountId)) {
            throw new Error('Cloud session storage is incomplete or invalid');
        }
        return { token, accountId };
    }

    save(session: CloudSession): void {
        if (!session.token || !/^(0|[1-9]\d*)$/.test(session.accountId)) {
            throw new Error('Cloud session is invalid');
        }
        const existing = this.load();
        if (existing && existing.accountId !== session.accountId) {
            throw new Error('Cloud session belongs to another account');
        }
        this.secrets.setSecret(ACCOUNT_SECRET_ID, session.accountId);
        this.secrets.setSecret(TOKEN_SECRET_ID, session.token);
    }
}