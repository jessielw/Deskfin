"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function archiveTools() {
  return import("../scripts/make-release-archive.mjs");
}

test("uses platform-appropriate portable release archive names", async () => {
  const { releaseArchiveName } = await archiveTools();
  assert.equal(
    releaseArchiveName({
      productName: "Deskfin",
      version: "0.1.0-beta.1",
      platform: "win32",
      arch: "x64",
    }),
    "Deskfin-0.1.0-beta.1-windows-x64.zip",
  );
  assert.equal(
    releaseArchiveName({
      productName: "Deskfin",
      version: "0.1.0-beta.1",
      platform: "darwin",
      arch: "arm64",
    }),
    "Deskfin-0.1.0-beta.1-macos-arm64.zip",
  );
  assert.equal(
    releaseArchiveName({
      productName: "Deskfin",
      version: "0.1.0-beta.1",
      platform: "linux",
      arch: "x64",
    }),
    "Deskfin-0.1.0-beta.1-linux-x64.tar.gz",
  );
});

test("accepts optional v prefixes but rejects mismatched release tags", async () => {
  const { assertReleaseTagVersion, releaseTagVersion } = await archiveTools();
  assert.equal(releaseTagVersion("v0.1.0-beta.1"), "0.1.0-beta.1");
  assert.equal(releaseTagVersion("0.1.0-beta.1"), "0.1.0-beta.1");
  assert.equal(releaseTagVersion(" v0.1.0-beta.1 "), "0.1.0-beta.1");
  assert.doesNotThrow(() =>
    assertReleaseTagVersion("0.1.0-beta.1", "v0.1.0-beta.1"),
  );
  assert.doesNotThrow(() =>
    assertReleaseTagVersion("0.1.0-beta.1", " v0.1.0-beta.1 "),
  );
  assert.throws(
    () => assertReleaseTagVersion("0.1.0-beta.1", "v0.1.0-beta.2"),
    /does not match/,
  );
});
