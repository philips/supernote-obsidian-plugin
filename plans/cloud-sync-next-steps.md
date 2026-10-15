# Cloud Sync Sprint Hand-Off

## Recommended Next Sprint: Cloud Sign-In and Session UX

1. Add a Cloud Engine settings section with signed-in/signed-out status and Sign
   in / Sign out controls. Implement the documented credential flow, including
   conditional email verification, and persist only the validated session token
   and account identity in device-local SecretStorage.
2. Handle signed-out, expired, rejected, and account-mismatched sessions for
   manual and scheduled Cloud sync with an actionable status and sign-in prompt.
   Avoid uncaught errors, silent failures, repeated scheduled notices, and
   background login/OTP attempts.
3. Add synthetic tests for authentication outcomes, cancellation, sign-out,
   manual/scheduled prompting, deduplication, and secret handling. Any live
   login/OTP check requires separate explicit authorization.
4. After this sprint, agree on a controlled synthetic fixture scope and
   permissions before testing live scheduled Cloud behavior. Do not mutate Cloud
   contents or broaden the fixture scope without explicit authorization; record
   only non-sensitive results in [`cloud-sync-plan.md`](cloud-sync-plan.md).
