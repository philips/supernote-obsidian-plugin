import { describe, expect, it, vi } from 'vitest';
import { CloudSignInRequiredError } from './cloudSyncEngine';
import { shouldPromptCloudSignIn } from './cloudSessionPrompt';

vi.mock('obsidian', () => ({ Platform: { isDesktop: true }, Notice: vi.fn(), TFile: class TFile {} }));

describe('Cloud sync session prompting', () => {
    it('prompts for a missing or rejected session, but not a mismatched account or transport error', () => {
        expect(shouldPromptCloudSignIn(new CloudSignInRequiredError())).toBe(true);
        expect(shouldPromptCloudSignIn(new Error('Sign in to Supernote Cloud in settings to resume sync'))).toBe(true);
        expect(shouldPromptCloudSignIn(new Error('Cloud mirror account binding does not match'))).toBe(false);
        expect(shouldPromptCloudSignIn(new Error('Supernote Cloud request timed out'))).toBe(false);
    });

});