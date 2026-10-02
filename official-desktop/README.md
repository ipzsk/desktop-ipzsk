# IPZSK Desktop Next

IPZSK Desktop Next is the official DeepSeek Harness Electron architecture with IPZSK account, model and plugin integrations. This directory owns the downstream overlay; the existing 2.x application and its pinned submodule remain separate.

The current preview is `3.0.0-beta.4`, based on upstream `0.2.0-rc.2` at `639ed015397290b3745d163aafe02ffee4aa3f84`. The complete downstream dsh package family, private Host and Electron shell share the product version. Vendored libraries retain their upstream versions.

When upgrading an existing installation, the client retains the pnpm store recorded by its installed plugin dependencies in the profile workspace settings. The plugin market continues to use that setting; explicit existing settings, global pnpm configuration, and task data remain unchanged. Desktop packages contain no first-party plugin archives; plugins are released separately and installed through the market.

## Runtime

- Electron starts its own Node-mode child process. The official Web Host listens on an OS-assigned loopback port with authenticated HTTP/WebSocket; the packaged renderer uses `dsh-app://app/`. The runtime is packaged inside ASAR, with native libraries and Office dependencies unpacked by the official rules.
- The account window owns login, encrypted session storage, balance, usage and voucher redemption. A one-time private IPC exchange supplies validated model credentials to the Host. Credentials do not enter renderer state, process arguments, environment variables or configuration files.
- The official Web plugin manager and the IPZSK market share profile package operations and their file lock. The IPZSK market re-fetches approved releases and checks archive identity, size, SHA-256 and desktop transport compatibility before using the official package lock and bundled pnpm.
- Plugins remain independently installed profile dependencies. They are excluded from the immutable shared Host package set.
- The preview uses `IPZSK Desktop Next` application data, separately from IPZSK Desktop 2.x. It does not migrate or rewrite existing sessions. Plugin job data lives outside the package profile so package operations and profile recovery do not replace it.

## Account integration

The sandboxed account window signs in through `https://api.ipzsk.com`, fetches the customer profile and desktop model authorization, then opens the official workspace. It supports encrypted session persistence, balance and usage, voucher redemption, and sign-out. Sign-out stops the Host and relaunches into login. The default model API is `https://api.ipzsk.com/v1` and uses the authorization returned by login; no API key entry is required. The IPZSK provider and default model are composed before any Host plugin starts. A still-authorized saved IPZSK model is retained. Account credentials stay in private IPC and memory rather than plugin configuration.

The official login-shell environment reader remains active for user tool paths and proxies while preserving the IPZSK data directory. Official Desktop product analytics and session-feedback reporting are disabled by default. Account, billing and model requests still use the IPZSK backend.

## Build

Use Node `^22.19.0` or `>=24`. The outer repository retains Yarn; the pinned official workspace uses its own pnpm `11.7.0` through Corepack.

```sh
cd official-desktop
node scripts/prepare.mjs
node scripts/run.mjs install
node scripts/run.mjs build
node scripts/run.mjs start
```

`prepare` verifies the pinned source archive checksum, restores only overlay-owned source files and applies reviewed patches into `.build/upstream`. It preserves dependencies and build outputs. No upstream submodule file is edited. `build` is headless; `start` explicitly opens the development application. Development mode follows the official policy that package mutations require a packaged application.

```sh
node scripts/package-preview.mjs
```

The local preview command currently builds macOS Apple Silicon. It retains the official runtime materialization, package graph, native payload and integrity checks. Its separately named preparation command omits signing only for the local preview; the original production signing and notarization commands remain intact. Preview artifacts have no updater configuration or publishing target.

Production builds require the product's signing and notarization identity and a separately hosted update stream. `IPZSK_DESKTOP_UPDATE_ORIGIN` replaces the upstream production origin. This preview does not change the existing website, GitHub releases or 2.x update channel.

## Validation

```sh
node --test tests/*.test.mjs
node scripts/build-plugins.mjs
node tests/plugin-host-smoke.mjs
```

The Host smoke uses a temporary profile, synthetic Word/PDF files, the real Cordis loader, ModuleLoader and authenticated loopback Web Host. It checks Word-to-Excel download, PDF upload across a 4 MiB chunk boundary and rejection of unauthenticated API requests. It makes no paid model requests.

Account, model and market behavior tests are copied to `.build/upstream/apps/desktop*/tests` with the overlay and run through the official Vitest setup. The document plugin also owns its Node and Python regression suites.

## Source ownership

- `upstream.lock.json`: immutable upstream source and downstream release identity.
- `patches/`: small changes to official composition, lifecycle, branding and package installation.
- `overlay/`: IPZSK account, market, model configuration and focused tests.
- `plugins/`: separately packaged plugin sources.
- `.build/`: generated sources, dependencies, logs and runtime inputs; excluded from Git.
- `artifacts/`: local preview artifacts; excluded from Git.

Upstream copyright, MIT license and third-party notices remain with the upstream runtime and packages.
