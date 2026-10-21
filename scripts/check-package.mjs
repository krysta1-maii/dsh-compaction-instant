import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Install the real tarball into its own dependency graph, never into a DSH profile.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const build = join(root, ".build");
mkdirSync(build, { recursive: true });
const cwd = mkdtempSync(join(build, "package-check-"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
// Spawn npm through the current npm CLI when invoked via npm run (Windows has
// no bare "npm" executable for execFile); fall back to the platform shim.
const npm = (args, options = {}) => process.env.npm_execpath
  ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, stdio: "inherit", ...options })
  : execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd, stdio: "inherit", shell: process.platform === "win32", ...options });
// Use a regular file for npm pack output: confined Windows runs may reject pipes.
const packOutput = join(cwd, "npm-pack.json");
const packOutputFd = openSync(packOutput, "w");
try {
  npm(["pack", "--json", "--ignore-scripts", "--pack-destination", build, "--cache", join(build, "npm-cache")], { cwd: root, stdio: ["ignore", packOutputFd, "inherit"] });
} finally {
  closeSync(packOutputFd);
}
const packReport = JSON.parse(readFileSync(packOutput, "utf8"));
// npm <=11 emits an array; npm 12 emits a map keyed by package name.
const packed = Array.isArray(packReport) ? packReport : Object.values(packReport);
assert.equal(packed.length, 1);
assert.equal(packed[0].name, manifest.name);
assert.equal(packed[0].version, manifest.version);
const tarball = join(build, packed[0].filename);
const iconPath = manifest.icon.replace(/^\.\//u, "");
for (const asset of [iconPath, "assets/LICENSE.lucide", "assets/README.md"]) {
  assert.ok(packed[0].files.some(file => file.path === asset), "missing packed asset: " + asset);
}
// Pin the entire tested runtime graph, including optional host capabilities.
// Platform-bound optional variants (node-addon-require-builtin-*) stay out of
// the manifest: as direct entries they would hard-fail on other platforms,
// while as optional dependencies of the pinned packages npm picks the local one.
const dependencies = Object.fromEntries(Object.entries(lock.packages)
  .filter(([path, entry]) => path.startsWith("node_modules/")
    && !/^node_modules\/(?:@types\/|typescript$|undici-types$)/u.test(path)
    && !(entry.optional === true && (entry.os !== undefined || entry.cpu !== undefined)))
  .map(([path, entry]) => [path.slice("node_modules/".length), entry.version]));
for (const [name, version] of Object.entries(manifest.devDependencies)) {
  if (name.startsWith("@deepseek-ai/")) dependencies[name] = version;
}
dependencies[manifest.name] = `file:${tarball}`;
writeFileSync(join(cwd, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }, null, 2) + "\n");
npm(["install", "--ignore-scripts", "--cache", join(build, "npm-cache")]);
npm(["ls", "--all"]);
const smoke = `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const installedPrefix = join(process.cwd(), "node_modules") + sep;
const pkgPath = require.resolve("dsh-compaction-instant/package.json");
assert.ok(pkgPath.startsWith(installedPrefix), pkgPath);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
assert.equal(pkg.version, ${JSON.stringify(manifest.version)});
for (const entry of Object.keys(pkg.exports)) {
  if (entry === "./client" || entry === "./package.json" || entry.endsWith("/icon")) continue;
  await import("dsh-compaction-instant" + (entry === "." ? "" : entry.slice(1)));
}
for (const [name, expectedVersion] of Object.entries(pkg.devDependencies).filter(([name]) => name.startsWith("@deepseek-ai/dsh-"))) {
  const path = require.resolve(name + "/package.json");
  assert.ok(path.startsWith(installedPrefix), path);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).version, expectedVersion, name);
}
const definitions = [];
vm.runInNewContext(readFileSync(require.resolve("dsh-compaction-instant/client"), "utf8"), {
  window: { __ModuleLoader__: { load: definition => definitions.push(definition) } },
});
assert.ok(definitions.some(definition => definition.id === "dsh-compaction-instant"));
assert.ok(readFileSync(new URL(pkg.dsh.bundle.patch, "file:" + pkgPath), "utf8").includes("dsh-compaction-instant/tool"));
const icon = readFileSync(join(dirname(pkgPath), pkg.icon), "utf8");
assert.equal(icon, ${JSON.stringify(readFileSync(join(root, manifest.icon), "utf8"))});
for (const entry of ["tool", "command", "settings"]) {
  assert.equal(readFileSync(require.resolve(pkg.name + "/" + entry + "/icon"), "utf8"), icon);
}
assert.equal(readFileSync(join(dirname(pkgPath), "assets/LICENSE.lucide"), "utf8"), ${JSON.stringify(readFileSync(join(root, "assets/LICENSE.lucide"), "utf8"))});
console.log("Tarball exports, icons, license, client registration, bundle and manifest-pinned DSH resolution passed");
`;
writeFileSync(join(cwd, "smoke.mjs"), smoke);
execFileSync(process.execPath, ["smoke.mjs"], { cwd, stdio: "inherit" });
// Keep copied tests under node_modules so normal node --test discovery ignores them.
const tests = join(cwd, "node_modules", "package-verification-tests");
mkdirSync(tests);
writeFileSync(join(tests, "package.json"), JSON.stringify({ type: "module" }));
const files = readdirSync(join(root, "test")).filter(name => name.endsWith(".test.js") && name !== "migration.test.js");
for (const file of files) {
  const source = readFileSync(join(root, "test", file), "utf8").replace(/"\.\.\/src\/([a-z-]+)\.js"/gu, (_, entry) => JSON.stringify(manifest.name + (entry === "index" ? "" : "/" + entry)));
  writeFileSync(join(tests, file), source);
}
execFileSync(process.execPath, ["--test", ...files.map(file => join(tests, file))], { cwd, stdio: "inherit" });
console.log(`Verified package: ${tarball}\nIsolated installation: ${cwd}`);
