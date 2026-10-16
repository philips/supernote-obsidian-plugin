import { CloudSignInRequiredError } from './cloudSyncEngine';

export function shouldPromptCloudSignIn(error: Error): boolean {
    return error instanceof CloudSignInRequiredError
        || error.message === 'Sign in to Supernote Cloud in settings to resume sync';
}