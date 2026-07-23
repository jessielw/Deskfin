"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../package.json");
const {
  COMPATIBILITY,
  supportsElectronVersion,
  supportsJellyfinWebVersion,
  supportsMpvVersion,
  supportsRuntimeTarget,
} = require("../build/shared/compatibility");

test("keeps the compatibility contract aligned with the bundled runtime", () => {
  assert.equal(
    packageJson.devDependencies.electron,
    COMPATIBILITY.electronVersion,
  );
  assert.equal(supportsElectronVersion(process.versions.electron || ""), false);
  assert.equal(supportsElectronVersion("43.1.1"), true);
  assert.equal(supportsElectronVersion("43.2.0"), false);
});

test("supports only the declared Jellyfin Web minor line", () => {
  assert.equal(supportsJellyfinWebVersion("10.11.0"), true);
  assert.equal(supportsJellyfinWebVersion("10.11.8"), true);
  assert.equal(supportsJellyfinWebVersion("10.10.7"), false);
  assert.equal(supportsJellyfinWebVersion("10.12.0"), false);
  assert.equal(supportsJellyfinWebVersion("invalid"), false);
});

test("accepts MPV 0.37 and newer releases", () => {
  assert.equal(supportsMpvVersion("0.36.0"), false);
  assert.equal(supportsMpvVersion("0.37.0"), true);
  assert.equal(supportsMpvVersion("0.39.0"), true);
  assert.equal(supportsMpvVersion("1.0.0"), true);
  assert.equal(supportsMpvVersion("unknown"), false);
});

test("limits release targets to the declared 64-bit platforms", () => {
  assert.equal(supportsRuntimeTarget("win32", "x64"), true);
  assert.equal(supportsRuntimeTarget("darwin", "arm64"), true);
  assert.equal(supportsRuntimeTarget("linux", "x64"), true);
  assert.equal(supportsRuntimeTarget("win32", "ia32"), false);
  assert.equal(supportsRuntimeTarget("linux", "arm64"), false);
});
