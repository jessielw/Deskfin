"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const installPlayer = require("../src/preload/install-player");

test("changes native-player eligibility without reinstalling the Jellyfin adapter", async (t) => {
  const listeners = new Map();
  const bridge = {
    status: async () => ({ backend: "web", startFullscreen: true }),
    on: (name, callback) => listeners.set(name, callback),
    openExternal: async () => true,
  };
  global.location = new URL("https://media.example/jellyfin/web/");
  global.window = { jellyfinDesktop: bridge };
  global.document = { getElementById: () => null };
  t.after(() => {
    delete global.document;
    delete global.location;
    delete global.window;
  });

  const result = installPlayer({
    serverUrl: "https://media.example/jellyfin",
    backend: "web",
    appName: "Deskfin",
    appVersion: "test",
    deviceName: "test",
  });
  assert.equal(result.installed, true);

  const Player = await global.window.jellyfinDcMpvPlayer();
  const player = new Player({
    events: { trigger() {} },
    appSettings: { get: () => 1, set() {} },
    playbackManager: { syncPlayEnabled: false },
  });
  const movie = { MediaType: "Video", RunTimeTicks: 1, Type: "Movie" };

  assert.equal(player.canPlayMediaType("Video"), false);
  assert.equal(player.canPlayItem(movie, {}), false);
  listeners.get("mode")({ value: "mpv" });
  assert.equal(player.canPlayMediaType("Video"), true);
  assert.equal(player.canPlayItem(movie, {}), true);
  listeners.get("mode")({ value: "web" });
  assert.equal(player.canPlayMediaType("Video"), false);
});

test("reports stopped playback before acknowledging native shutdown", async (t) => {
  const listeners = new Map();
  const order = [];
  let acknowledge;
  const acknowledged = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const bridge = {
    status: async () => ({ backend: "mpv", startFullscreen: false }),
    on: (name, callback) => listeners.set(name, callback),
    load: async () => true,
    stop: async () => {
      order.push("native-stop");
      return true;
    },
    shutdownReady: async (requestId) => {
      order.push(`ack:${requestId}`);
      acknowledge();
      return true;
    },
    openExternal: async () => true,
  };
  global.location = new URL("https://media.example/jellyfin/web/");
  global.window = { jellyfinDesktop: bridge };
  global.document = { getElementById: () => null };
  t.after(() => {
    delete global.document;
    delete global.location;
    delete global.window;
  });

  installPlayer({
    serverUrl: "https://media.example/jellyfin",
    backend: "mpv",
    appName: "Deskfin",
    appVersion: "test",
    deviceName: "test",
  });
  const Player = await global.window.jellyfinDcMpvPlayer();
  const playbackManager = {
    syncPlayEnabled: false,
    async stop(target) {
      order.push("playback-manager-stop");
      await target.stop();
      order.push("playback-manager-done");
    },
  };
  const player = new Player({
    events: {
      trigger(_target, name) {
        if (name === "stopped") order.push("stopped-event");
      },
    },
    appSettings: { get: () => 1, set() {} },
    playbackManager,
  });
  await player.play({
    url: "https://media.example/jellyfin/Videos/1/stream",
    item: { MediaType: "Video", RunTimeTicks: 60_000_000, Type: "Movie" },
    mediaSource: { MediaStreams: [] },
  });

  listeners.get("shutdown")({ requestId: "shutdown-1", reason: "quit" });
  await acknowledged;

  assert.deepEqual(order, [
    "playback-manager-stop",
    "native-stop",
    "stopped-event",
    "playback-manager-done",
    "ack:shutdown-1",
  ]);
  assert.equal(player.currentSrc(), null);
});

test("acknowledges shutdown immediately when MPV has no active item", async (t) => {
  const listeners = new Map();
  let acknowledgedRequest = null;
  const bridge = {
    status: async () => ({ backend: "mpv", startFullscreen: true }),
    on: (name, callback) => listeners.set(name, callback),
    shutdownReady: async (requestId) => {
      acknowledgedRequest = requestId;
      return true;
    },
    openExternal: async () => true,
  };
  global.location = new URL("https://media.example/jellyfin/web/");
  global.window = { jellyfinDesktop: bridge };
  t.after(() => {
    delete global.location;
    delete global.window;
  });

  installPlayer({
    serverUrl: "https://media.example/jellyfin",
    backend: "mpv",
    appName: "Deskfin",
    appVersion: "test",
    deviceName: "test",
  });
  listeners.get("shutdown")({
    requestId: "shutdown-idle",
    reason: "window-close",
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(acknowledgedRequest, "shutdown-idle");
});
