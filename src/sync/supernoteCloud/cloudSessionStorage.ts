import type { App } from 'obsidian';

const TOKEN_SECRET_ID = 'supernote-cloud-access-token';
const ACCOUNT_SECRET_ID = 'supernote-cloud-account-id';

export interface CloudSession {
    token: string;
    userId: string;
}

export class CloudSessionStorage {
    constructor(private readonly secrets: App['secretStorage']) {}

    load(): CloudSession | null {
        const token = this.secrets.getSecret(TOKEN_SECRET_ID);
        const userId = this.secrets.getSecret(ACCOUNT_SECRET_ID);
        if (!token && !userId) return null;
        if (!token || !userId || !/^(0|[1-9]\d*)$/.test(userId)) {
            throw new Error('Cloud session storage is incomplete or invalid');
        }
        return { token, userId };
    }

    save(session: CloudSession): void {
        if (!session.token || !/^(0|[1-9]\d*)$/.test(session.userId)) {
            throw new Error('Cloud session is invalid');
        }
        const existing = this.load();
        if (existing && existing.userId !== session.userId) {
            throw new Error('Cloud session belongs to another account');
        }
        this.secrets.setSecret(ACCOUNT_SECRET_ID, session.userId);
        this.secrets.setSecret(TOKEN_SECRET_ID, session.token);
    }

    clear(): void {
        this.secrets.setSecret(TOKEN_SECRET_ID, '');
        this.secrets.setSecret(ACCOUNT_SECRET_ID, '');
    }
}