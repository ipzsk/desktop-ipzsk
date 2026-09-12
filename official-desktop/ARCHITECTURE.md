# Official desktop migration

Status: preview implementation.

The 2.x product runs its Cordis Host inside Electron and serves its renderer over loopback HTTP. The Next product uses the official desktop source at a fixed commit, a separate upstream Node process, versioned byte pipes and the official custom protocol. The migration keeps the upstream checkout immutable and stores all downstream changes as an owned overlay.

## Product ownership

The official shell owns process lifetime, the profile package lock, package graph validation, runtime integrity and update coordination. IPZSK owns account access, model bootstrap, the reviewed market and product identity. Plugins own document/image processing and remain independent profile dependencies.

Login completes in a dedicated sandboxed account window. Electron checks the originating window and main frame for each privileged request. Renderer code cannot invoke arbitrary IPC, pnpm commands or filesystem operations. A validated startup message crosses the private parent-child channel after the child explicitly requests it; the Host receives credentials only in memory. Parent disconnect, cancellation and startup failure have real-process regression coverage.

The market renderer sends only a plugin ID and approved release ID. Electron obtains current account-authorized metadata, verifies the archive and installs it through the same official package lock used by the native manager. Reviewed archives are addressed by SHA-256 and cannot be replaced through a generic npm update. The original official policy of retaining partial package state after failure remains in effect; this migration does not claim transactional rollback.

## Release and data

The product release gives all first-party dsh packages, the private Host and the Electron shell the same version. A separate source pin records the upstream API baseline. A plugin compatibility decision uses that API baseline, not the numerically higher IPZSK product version.

The preview has a separate app identity and data directory. It does not migrate or downgrade 2.x sessions. Plugin data is outside the package profile. First-run preview plugins are installed into the mutable profile, with immutable distribution files kept in application resources; they are not shared core packages.

The local preview path produces an unsigned application with no publishing or auto-update configuration. Production paths retain mandatory signing, notarization and integrity checks and require an explicitly configured IPZSK update origin. Changing the architecture alone does not establish a signed production release or update the existing website.

## Verification boundaries

Tests use synthetic account responses, temporary profiles and generated documents. They exercise real provider calls against mocked HTTP, actual Cordis/plugin loading, module graph loading, framed streaming, npm installation, process startup and cancellation. Real accounts and paid model requests are not used by automated checks. Cross-platform signing, existing-session migration and large real-world document accuracy require their own acceptance runs.
