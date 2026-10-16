import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ Modal: class Modal {}, Notice: class Notice {} }));

import { cloudImportFailureNotice } from './CloudSessionImportModal';

describe('Cloud session import failure notices', () => {
    it('distinguishes invalid input, account binding, request, and SecretStorage errors', () => {
        expect(cloudImportFailureNotice(new Error('Cloud session cache is invalid'))).toContain('valid session JSON');
        expect(cloudImportFailureNotice(new Error('Cloud session belongs to another account'))).toContain('account does not match');
        expect(cloudImportFailureNotice(new Error('Supernote Cloud request failed'))).toContain('request failed');
        expect(cloudImportFailureNotice(new Error('Supernote Cloud request failed (account identity: fetch rejected (TypeError))')))
            .toContain('account identity: fetch rejected (TypeError)');
        expect(cloudImportFailureNotice(new Error('Supernote Cloud request timed out'))).toContain('timed out');
        expect(cloudImportFailureNotice(new Error('Supernote Cloud request failed (HTTP 403)'))).toContain('HTTP 403');
        expect(cloudImportFailureNotice(new Error('SecretStorage did not retain the validated session'))).toContain('SecretStorage');
    });

    it('never echoes unclassified exception text', () => {
        const notice = cloudImportFailureNotice(new Error('unexpected token-secret account-secret'));
        expect(notice).not.toContain('token-secret');
        expect(notice).not.toContain('account-secret');
        expect(notice).toContain('account verification');
    });
});