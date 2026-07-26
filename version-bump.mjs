import { readFileSync, writeFileSync } from "fs";

const isBeta = process.argv.includes("--beta");
const manifestFile = isBeta ? "manifest-beta.json" : "manifest.json";

// npm's "version" lifecycle script (stable) exposes the new version via
// npm_package_version. There's no such lifecycle for beta bumps, so that
// path takes the target version as a CLI arg instead: `--beta 3.0.2`.
const targetVersion = isBeta
	? process.argv[process.argv.indexOf("--beta") + 1]
	: process.env.npm_package_version;

if (!targetVersion) {
	throw new Error(
		isBeta
			? "Usage: node version-bump.mjs --beta <version>"
			: "npm_package_version is not set; run this via `npm version`",
	);
}

// read minAppVersion from the manifest and bump version to target version
let manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync(manifestFile, JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
}
