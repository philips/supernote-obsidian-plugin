# Cloud Sync Next Steps

## Completed

- Implemented and synthetically tested the read-only Cloud authentication flow.
- Verified production password login, email verification, CSRF refresh, token completion, and account identity in two fresh sessions on October 12, 2026.
- Confirmed that OTP submission may return HTTP 403 and requires one CSRF refresh followed by one retry.
- Recorded the result in `plans/cloud-protocol-observations/2026-10-12-auth-identity.md`.

## Next

- Rotate the diagnostic account password because it was previously entered directly in terminal history.
- Update the specification's validation status from unresolved to observed for authentication and identity.
- Validate Cloud inventory pagination and canonical paths using synthetic account content.
- Validate download descriptors, redirect hosts, and checksum-protected transfers.
- Then implement the shared manifest and one-way Cloud mirror.

No inventory, download, manifest, or product UI work has started yet.
