# Development setup

`src/main.ts` and `src/myworker.worker.ts` import from `supernote-typescript`. It's
intentionally **not** an npm dependency in `package.json` — it's developed alongside
this plugin as a git submodule at `supernote-typescript/` (see `.gitmodules`), so
edits to the library and the plugin can happen together without publishing to npm
first. Run `./scripts/build` to set it up and build everything:

1. `git submodule init && git submodule update`
2. Install + build the submodule (`npm run build` there, i.e. `tsc`, producing
   `supernote-typescript/lib/`)
3. `npm install` and build this project

`tsconfig.json`'s `compilerOptions.paths` and `esbuild.config.mjs`'s `alias` both
point the `supernote-typescript` import specifier straight at the submodule
directory (compiled `lib/` for TS, the package directory for esbuild). **Don't
route this through a `node_modules/supernote-typescript` symlink, `npm link`, or a
`file:supernote-typescript` dependency** — all three were tried and abandoned:

- A plain symlink at `node_modules/supernote-typescript` gets reached through and
  wiped by any subsequent `npm install` in this project, even one unrelated to the
  submodule (npm's arborist treats anything inside `node_modules/` as part of the
  tree it manages/prunes). Confirmed repeatedly: the submodule's own
  `node_modules` — `image-js`, `color`, `fs-extra`, etc. — would vanish after a
  routine root-level `npm install`, breaking the build in confusing ways (missing
  exports, wrong versions) that look like upstream API breaks but aren't. Pointing
  `paths`/`alias` at the submodule directly, instead of through anything living
  inside `node_modules/`, avoids this: npm's install never sees or touches it.
- `npm link` needs write access to the global npm prefix, which sandboxes/CI/some
  setups don't have.
- A `file:supernote-typescript` dependency's default (symlink) install mode also
  installs the *entire* devDependency tree of the linked package into this project
  (jest, eslint, prettier, a native module requiring a C++ toolchain) — confirmed
  by testing, it took root `node_modules` from ~280 packages to ~750.

The submodule's `v8-profiler-next` devDependency (used only by its own test suite,
not its build) needs a native toolchain to compile. If that's unavailable, install
with `--ignore-scripts` — the library build itself doesn't need it, only
`npm test` (inside `supernote-typescript/`) does. `scripts/build` does this
automatically.

Root `package.json` also carries its own `image-js` dependency, matched to
whatever major version the submodule currently uses (`^1.7.0` as of
supernote-typescript v0.4.0) — used to encode `Image` objects that
`supernote-typescript` hands back (`encode`/`encodeDataURL`; the `Image` class
itself dropped its `toBuffer`/`toDataURL` instance methods in image-js v1). Bump
both together when updating the submodule.
