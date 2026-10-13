export const CLOUD_PRODUCTION_ORIGIN = 'https://cloud.supernote.com';

export const CLOUD_CONTROL_PLANE_TIMEOUT_MS = 20_000;
export const CLOUD_AUTH_IDENTITY_REQUEST_LIMIT = 20;
export const CLOUD_LIST_PAGE_SIZE = 100;
export const CLOUD_MAX_PAGES_PER_DIRECTORY = 1_000;
export const CLOUD_MAX_INVENTORY_ITEMS = 100_000;
export const CLOUD_MAX_DIRECTORY_DEPTH = 128;
// Product safety ceilings from the Cloud sync specification, not claims about
// the service's undocumented limits. Select one for the active platform.
export const CLOUD_MAX_DESKTOP_FILE_BYTES = 256 * 1024 * 1024;
export const CLOUD_MAX_MOBILE_FILE_BYTES = 128 * 1024 * 1024;

export const CLOUD_ROUTES = {
    csrf: '/api/csrf',
    loginNonce: '/api/official/user/query/random/code',
    passwordLogin: '/api/official/user/account/login/new',
    verificationPreAuth: '/api/user/validcode/pre-auth',
    verificationSend: '/api/user/mail/validcode/send',
    verificationLogin: '/api/official/user/sms/login',
    queryToken: '/api/user/query/token',
    accountIdentity: '/api/user/query',
    directoryList: '/api/file/list/query',
    pathQuery: '/api/file/path/query',
} as const;

// Candidate request shape from compatible hosted-Cloud clients. The protocol
// harness records whether production accepts these exact names and value types.
export const CLOUD_PASSWORD_LOGIN_PROFILE = {
    countryCode: 1,
    browser: 'Chrome107',
    equipment: '1',
    loginMethod: '1',
    language: 'en',
} as const;

export const CLOUD_VERIFICATION_LOGIN_PROFILE = {
    browser: 'Chrome107',
    equipment: '4',
} as const;