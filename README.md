# Supernote Obsidian Plugin

This plugin generates PNGs and markdown files for any `*.note` files found in your Obsidian Vault. The files will be named based on the filename of the note and the page number of the note like so: `test.note-0.png`, `test.note-1.png`, `test.note-1.md`, `test.note-2.md`.

## Install via BRAT

- Install the BRAT plugin via Community Plugin Search
- [Read the docs](https://tfthacker.com/BRAT)
- Add `https://github.com/philips/obsidian-plugin-supernote`

## Manually installing the plugin

- Copy over `main.js`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/obsidian-plugin-supernote/` from https://github.com/philips/obsidian-plugin-supernote/releases.

## Roadmap / Ideas

- 📺 [Screen mirroring](https://support.supernote.com/en_US/organizing-managing/1791924-screen-mirroring) capture directly to the current note
- 🔗 Note linking
- 🎛️ Settings panel to control file layout, linking, and more
- 🚀 Get listed in the official Obsidian community plugin list

## Thank You

Thank you to [Tiemen Schuijbroek](https://gitlab.com/Tiemen/supernote) for developing the initial supernote Typescript library I forked.

## Developer Notes

### How to use

- Make sure your NodeJS is at least v16 (`node --version`).
- Clone this repo.
- Setup the deps

```
git submodule init
git submodule update
cd supernote-typescript/
npm run build
npm link
cd ..
npm link supernote-typescript/
```

- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.


