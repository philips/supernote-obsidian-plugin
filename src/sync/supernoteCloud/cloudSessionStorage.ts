import type { App } from 'obsidian';

const TOKEN_SECRET_ID = 'journal-companion-cloud-access-token';
const ACCOUNT_SECRET_ID = 'journal-companion-cloud-account-id';
const MIGRATED_SECRET_ID = 'journal-companion-cloud-session-migrated';
const LEGACY_TOKEN_SECRET_ID = 'supernote-cloud-access-token';
const LEGACY_ACCOUNT_SECRET_ID = 'supernote-cloud-account-id';

export interface CloudSession {
    token: string;
    userId: string;
}

export class CloudSessionStorage {
    constructor(private readonly secrets: App['secretStorage']) {}

    load(): CloudSession | null {
        const current = this.read(TOKEN_SECRET_ID, ACCOUNT_SECRET_ID);
        if (current || this.secrets.getSecret(MIGRATED_SECRET_ID) === '1') return current;
        const legacy = this.read(LEGACY_TOKEN_SECRET_ID, LEGACY_ACCOUNT_SECRET_ID);
        if (legacy) {
            this.secrets.setSecret(ACCOUNT_SECRET_ID, legacy.userId);
            this.secrets.setSecret(TOKEN_SECRET_ID, legacy.token);
            this.secrets.setSecret(MIGRATED_SECRET_ID, '1');
        }
        return legacy;
    }

    private read(tokenId: string, accountId: string): CloudSession | null {
        const token = this.secrets.getSecret(tokenId);
        const userId = this.secrets.getSecret(accountId);
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
        this.secrets.setSecret(MIGRATED_SECRET_ID, '1');
    }

    clear(): void {
        this.secrets.setSecret(TOKEN_SECRET_ID, '');
        this.secrets.setSecret(ACCOUNT_SECRET_ID, '');
        this.secrets.setSecret(MIGRATED_SECRET_ID, '1');
    }
}