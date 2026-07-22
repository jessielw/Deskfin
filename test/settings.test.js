"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SETTINGS_VERSION,
  loadSettings,
  normalizeSettings,
  removeServer,
  saveSettings,
  upsertServer,
} = require("../build/shared/settings");

test("migrates single-server settings into the server list", () => {
  const legacyId = "legacy:https://media.example/jellyfin";
  assert.deepEqual(
    normalizeSettings({
      serverUrl: "https://media.example/jellyfin/web/",
      playbackMode: "mpv",
      startMpvFullscreen: false,
      mpvPresentation: "user",
      mpvPath: " C:\\tools\\mpv.exe ",
    }),
    {
      version: SETTINGS_VERSION,
      playbackMode: "mpv",
      startMpvFullscreen: false,
      mpvPresentation: "user",
      servers: [
        {
          id: legacyId,
          name: "media.example",
          url: "https://media.example/jellyfin",
        },
      ],
      activeServerId: legacyId,
      mpvPath: "C:\\tools\\mpv.exe",
    },
  );
});

test("uses safe defaults for missing or unsupported settings", () => {
  assert.deepEqual(normalizeSettings({ playbackMode: "broken" }), {
    version: SETTINGS_VERSION,
    playbackMode: "web",
    startMpvFullscreen: true,
    mpvPresentation: "jellyfin",
    servers: [],
  });
});

test("upserts, activates, and removes server profiles", () => {
  const first = upsertServer(normalizeSettings(), {
    id: "one",
    name: "Home",
    url: "https://home.example",
    version: "10.11.0",
  });
  const second = upsertServer(first, {
    id: "two",
    name: "Family",
    url: "https://family.example",
  });
  assert.equal(second.servers.length, 2);
  assert.equal(second.activeServerId, "two");

  const removed = removeServer(second, "two");
  assert.deepEqual(
    removed.servers.map((server) => server.id),
    ["one"],
  );
  assert.equal(removed.activeServerId, "one");
});

test("replaces a migrated URL profile with Jellyfin's stable server ID", () => {
  const migrated = normalizeSettings({
    serverUrl: "https://media.example/jellyfin",
  });
  const upgraded = upsertServer(
    migrated,
    {
      id: "stable-server-id",
      name: "Media",
      url: "https://media.example/jellyfin",
      version: "10.11.0",
    },
    migrated.activeServerId,
  );

  assert.equal(upgraded.servers.length, 1);
  assert.equal(upgraded.servers[0].id, "stable-server-id");
  assert.equal(upgraded.activeServerId, "stable-server-id");
});

test("refreshing a saved server does not reorder the picker", () => {
  const settings = normalizeSettings({
    servers: [
      { id: "one", name: "One", url: "https://one.example" },
      { id: "two", name: "Two", url: "https://two.example" },
    ],
    activeServerId: "two",
  });
  const refreshed = upsertServer(settings, {
    id: "one",
    name: "One renamed",
    url: "https://one.example",
  });

  assert.deepEqual(
    refreshed.servers.map((server) => server.id),
    ["one", "two"],
  );
  assert.equal(refreshed.activeServerId, "one");
});

test("round trips settings through the versioned JSON file", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "jellyfin-dc-settings-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "settings.json");

  saveSettings(filePath, {
    servers: [
      {
        id: "local-server",
        name: "Local",
        url: "http://127.0.0.1:8096",
      },
    ],
    activeServerId: "local-server",
    playbackMode: "mpv",
    startMpvFullscreen: false,
  });

  assert.deepEqual(loadSettings(filePath), {
    version: SETTINGS_VERSION,
    playbackMode: "mpv",
    startMpvFullscreen: false,
    mpvPresentation: "jellyfin",
    servers: [
      {
        id: "local-server",
        name: "Local",
        url: "http://127.0.0.1:8096",
      },
    ],
    activeServerId: "local-server",
  });
});

test("recovers from malformed settings without failing startup", (t) => {
  const warnings = [];
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "jellyfin-dc-settings-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "settings.json");
  fs.writeFileSync(filePath, "{invalid", "utf8");

  assert.equal(
    loadSettings(filePath, {
      logger: { warn: (...values) => warnings.push(values) },
    }).playbackMode,
    "web",
  );
  assert.equal(warnings.length, 1);
});
