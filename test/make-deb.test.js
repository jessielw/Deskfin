"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("uses a conventional Debian package filename", async () => {
  const { debArtifactName } = await import("../scripts/make-deb.mjs");
  assert.equal(
    debArtifactName("Deskfin", "0.1.0-beta.2"),
    "Deskfin_0.1.0-beta.2_amd64.deb",
  );
});
