# Development setup

`src/main.ts` and `src/myworker.worker.ts` import from `supernote-typescript`, but
`package.json`'s `dependencies.supernote` entry resolves to a stale pinned commit
(see `package-lock.json`) from before the package was renamed from `supernote` to
`supernote-typescript`. A plain `npm install` alone will never satisfy that import —
`tsc` fails with `Cannot find module 'supernote-typescript'`.

The real dependency lives as a git submodule at `supernote-typescript/` (see
`.gitmodules`) and must be built and linked in manually. Run `./scripts/build` to do
all of this:

1. `git submodule init && git submodule update`
2. Install + build the submodule (`npm run build` there, i.e. `tsc`)
3. Link it into this project's `node_modules/supernote-typescript`

`scripts/build` prefers real `npm link`, but falls back to a direct
`node_modules/supernote-typescript` symlink when the global npm prefix isn't
writable (common in sandboxes/CI without root). If you ever hand-roll this step:
create the symlink **after** `npm install`, not before — plain `npm install` prunes
symlinks it doesn't recognize as npm-linked.

The submodule's `v8-profiler-next` devDependency (used only by its test suite, not
its build) needs a native toolchain to compile. If that's unavailable, install with
`--ignore-scripts` — the library build itself doesn't need it, only `npm test` does.
