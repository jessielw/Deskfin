"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  resolveMpvIntegrationScript,
  resolvePreloadPath,
  resolveSettingsPagePath,
  resolveSettingsPreloadPath,
  resolveServersPagePath,
  resolveServersPreloadPath,
} = require("../build/main/runtime-paths");

test("resolves development resources from the application tree", () => {
  const appPath = path.resolve("example-app");
  assert.equal(
    resolvePreloadPath(appPath),
    path.join(appPath, "dist", "preload.js"),
  );
  assert.equal(
    resolveSettingsPreloadPath(appPath),
    path.join(appPath, "dist", "settings-preload.js"),
  );
  assert.equal(
    resolveServersPagePath(appPath),
    path.join(appPath, "src", "renderer", "servers", "index.html"),
  );
  assert.equal(
    resolveServersPreloadPath(appPath),
    path.join(appPath, "dist", "servers-preload.js"),
  );
  assert.equal(
    resolveSettingsPagePath(appPath),
    path.join(appPath, "src", "renderer", "settings", "index.html"),
  );
  assert.equal(
    resolveMpvIntegrationScript({
      appPath,
      isPackaged: false,
      resourcesPath: path.resolve("packaged-resources"),
    }),
    path.join(appPath, "resources", "mpv", "jellyfin_dc.lua"),
  );
});

test("resolves the MPV bridge from packaged extra resources", () => {
  const resourcesPath = path.resolve("packaged-resources");
  assert.equal(
    resolveMpvIntegrationScript({
      appPath: path.resolve("app.asar"),
      isPackaged: true,
      resourcesPath,
    }),
    path.join(resourcesPath, "mpv", "jellyfin_dc.lua"),
  );
});
