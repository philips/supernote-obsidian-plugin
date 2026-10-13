# Cloud Date-Based Import Proposal

**Status:** Potential future feature. Not approved for implementation.

This document records an initial direction for supporting the existing
date-based import workflow when the Cloud engine is active. Cloud sync remains a
separate one-way mirror that copies original `.note` and `.spd` bytes unchanged.
This proposal does not change sync behavior or the Cloud protocol harness.

## Current IP Behavior

The existing date-based import modal scans the Direct IP device tree for `.note`
and `.spd` files, parses each device-provided date, selects files that match the
chosen local calendar day, downloads the selected bytes, then passes them to the
existing conversion pipeline. The user can choose to link or embed the original
file, render images, create a PDF, or include recognized text with `.note` page
images where available.

The `importFormat` preference is the default for that import dialog. It is not
used by either sync engine. The conversion logic already lives above the
transport boundary, so a future Cloud-backed import should reuse it rather than
add separate Cloud-specific conversion implementations.

## Possible Shared Boundary

Keep date import outside `SyncEngine`, whose contract is about mirror runs and
sync history. If the feature is approved, introduce a narrow source capability
that can:

- List importable files with stable source IDs, names, and creation/update
  timestamps.
- Fetch the original bytes for one selected file.
- Report source-specific readiness without starting a sync.

Provide an IP adapter over the current device-tree scan and transfer functions,
and a Cloud adapter over Cloud inventory and verified descriptor/download
operations. The shared date-import workflow can filter by date, present the
selection UI, fetch bytes through the adapter, and call the existing conversion
pipeline. No Cloud browsing or folder-selection UI is necessary for this initial
shape.

Engine switching and imports must not race. The implementation should either
hold a shared source-operation lock for the duration of an import or otherwise
ensure that the selected source cannot change between inventory and download.

## Cloud Evidence Required

The public Cloud listing schema includes `createTime` and `updateTime`, but
production timestamp formatting, timezone semantics, and the exact meaning of
each field have not been validated. The IP workflow currently compares device
dates with the user's local calendar day. Cloud support needs an explicit date
policy before matching behavior can be claimed equivalent.

Cloud imports also depend on the separate protocol gates for canonical paths,
download descriptors, redirect-host validation, checksum verification, and
transfer behavior. Reuse of those verified operations is required; the import
feature must not bypass their safety checks.

## Product Decisions Before Implementation

- Whether date-based import uses the active sync engine or has its own source
  selector. Using the active engine is the simpler initial model and matches the
  current settings note, but should be confirmed.
- Whether date matching uses Cloud creation time, update time, or either time
  when both exist.
- How timestamp timezone and date-only boundaries are presented to the user.
- Whether imported Cloud items display paths or only filenames when duplicate
  names exist.
- Whether the Cloud engine must be signed in even when it is not active.
- Whether the shared `Default format` preference applies unchanged to imports
  from either source.

## Non-Goals

- Changing Cloud sync from raw-byte mirroring to conversion.
- Applying the custom dictionary to mirrored bytes.
- Adding Cloud upload, move, rename, or delete operations.
- Adding Cloud folder browsing as a prerequisite for date import.
- Implementing this feature as part of the current Cloud mirror milestone.

## Suggested Implementation Sequence

1. Resolve Cloud timestamp and timezone semantics with synthetic account content
   and a secret-free production observation when an authorized session is
   available.
2. Complete and validate Cloud descriptor/download behavior in the existing
   protocol work.
3. Define and test the transport-neutral date-import source contract using
   synthetic IP and Cloud sources.
4. Adapt the current modal to that contract without changing its conversion
   output or saved `importFormat` key.
5. Add Cloud source tests for date filtering, missing or malformed timestamps,
   duplicate filenames, transfer failures, checksum mismatch, and engine/source
   switching during an import.
6. Confirm the complete flow in Obsidian with the Cloud engine active.
