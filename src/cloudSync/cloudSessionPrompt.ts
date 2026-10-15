import { CloudSignInRequiredError } from './cloudSyncEngine';

export function shouldPromptCloudSignIn(error: Error): boolean {
    return error instanceof CloudSignInRequiredError
        || error.message === 'Sign in to Supernote Cloud in settings to resume sync';
}

export class CloudSessionNoticeGate {
    private lastReason: string | null = null;

    shouldNotify(reason: string): boolean {
        if (this.lastReason === reason) return false;
        this.lastReason = reason;
        return true;
    }

    reset(): void { this.lastReason = null; }
}