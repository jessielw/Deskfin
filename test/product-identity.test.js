"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PRODUCT_IDENTITY } = require("../build/shared/product");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);

test("runtime and package metadata share one stable product identity", () => {
  assert.equal(packageJson.name, PRODUCT_IDENTITY.packageName);
  assert.equal(packageJson.productName, PRODUCT_IDENTITY.name);
  assert.equal(packageJson.noktus.appId, PRODUCT_IDENTITY.appId);
  assert.equal(packageJson.noktus.executableName, PRODUCT_IDENTITY.executableName);
  assert.equal(packageJson.noktus.category, PRODUCT_IDENTITY.category);
  assert.match(PRODUCT_IDENTITY.appId, /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/);
});

test("all package icon formats are present and recognizable", () => {
  const iconDirectory = path.join(projectRoot, "resources", "icons");
  const png = fs.readFileSync(path.join(iconDirectory, "noktus.png"));
  const ico = fs.readFileSync(path.join(iconDirectory, "noktus.ico"));
  const icns = fs.readFileSync(path.join(iconDirectory, "noktus.icns"));

  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 9);
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
});
