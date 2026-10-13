# Supernote Cloud Authentication Observation

- Test date: October 12, 2026
- Scope: password sign-in, email verification, CSRF/session handling, and account identity
- Result: pass in two fresh sessions
- Production origin: `https://cloud.supernote.com`
- Account identity: the same canonical decimal `userId` was returned in both sessions; the raw value is intentionally not recorded

## Observed Flow

Each fresh session completed this read-only sequence:

1. `GET /api/csrf`
2. `POST /api/official/user/query/random/code`
3. `POST /api/official/user/account/login/new`, which returned the verification-required branch
4. `POST /api/user/validcode/pre-auth`
5. `POST /api/user/mail/validcode/send`
6. `POST /api/official/user/sms/login`
7. `GET /api/csrf` after the OTP request returned HTTP 403
8. Retry `POST /api/official/user/sms/login` once with refreshed CSRF state
9. `POST /api/user/query/token`
10. `POST /api/user/query`

The OTP request returned HTTP 403 in both fresh sessions. Refreshing CSRF state and retrying the same OTP request once succeeded in both sessions.

## Evidence Boundary

The observation records only route shapes, response categories, field types, cookie names, and the fact that both sessions returned the same canonical account identity. Passwords, verification codes, session tokens, CSRF values, pre-auth values, valid-code keys, cookies, profile values, and raw response bodies were not retained.

This is evidence for the tested account and date, not a general service guarantee.
