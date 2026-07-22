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
  t.after(() => {
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
