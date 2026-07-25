# Development setup

`src/main.ts` and `src/myworker.worker.ts` import from `supernote-typescript`. It's
intentionally **not** an npm dependency in `package.json` — it's developed alongside
this plugin as a git submodule at `supernote-typescript/` (see `.gitmodules`), so
edits to the library and the plugin can happen together without publishing to npm
first. Run `./scripts/build` to set it up and build everything:

1. `git submodule init && git submodule update`
2. Install + build the submodule (`npm run build` there, i.e. `tsc`)
3. `npm install` for this project, then symlink
   `node_modules/supernote-typescript -> ../supernote-typescript` by hand (npm has
   no declared dependency to link automatically, since none exists in
   `package.json`)
4. Build this project

Two things trip this up if you hand-roll it instead of using the script:

- **Order matters**: the symlink must be created *after* `npm install`, not before.
  Plain `npm install` prunes symlinks in `node_modules` that it doesn't recognize as
  declared dependencies.
- **Don't switch this to `npm link` or a `file:` dependency.** `npm link` needs
  write access to the global npm prefix, which sandboxes/CI/some setups don't have.
  A `file:supernote-typescript` dependency seems cleaner, but npm's default
  (symlink) mode for local directory dependencies also installs the *entire*
  devDependency tree of the linked package into this project (jest, eslint,
  prettier, and a native module requiring a C++ toolchain) — confirmed by testing,
  it took root `node_modules` from ~280 packages to ~750. The manual symlink avoids
  that entirely: it's a real live symlink (submodule rebuilds show up immediately,
  no reinstall needed) with none of the extra weight.

The submodule's `v8-profiler-next` devDependency (used only by its own test suite,
not its build) needs a native toolchain to compile. If that's unavailable, install
with `--ignore-scripts` — the library build itself doesn't need it, only
`npm test` (inside `supernote-typescript/`) does. `scripts/build` does this
automatically.
