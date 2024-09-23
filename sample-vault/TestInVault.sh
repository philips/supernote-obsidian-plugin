#!/bin/bash
# Copy the built plugin in to the Sample vault.
# Should be run from the Git Repo Root.

set -euo pipefail

cp main.js manifest.json styles.css \
    sample-vault/Supernote-Plugin-Demo/.obsidian/plugins/supernote-obsidian-plugin

touch sample-vault/Supernote-Plugin-Demo/.obsidian/plugins/supernote-obsidian-plugin/.hotreload