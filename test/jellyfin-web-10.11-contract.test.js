"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const installPlayer = require("../src/preload/install-player");
const { supportsJellyfinWebVersion } = require("../build/shared/compatibility");

function jellyfinWeb10_11Fixture() {
  const events = [];
  const playback = [];
  const args = {
    events: {
      trigger(_target, name) {
        events.push(name);
      },
    },
    appSettings: {
      get: () => 0.8,
      set(name, value) {
        playback.push(["setting", name, value]);
      },
    },
    playbackManager: {
      syncPlayEnabled: false,
      async stop(target) {
        playback.push(["stop"]);
        await target.stop();
      },
      async nextTrack() {
        playback.push(["next"]);
      },
      async previousTrack() {
        playback.push(["previous"]);
      },
    },
  };
  return { version: "10.11.8", args, events, playback };
}

test("exercises the native player against the Jellyfin Web 10.11 contract", async (t) => {
  const fixture = jellyfinWeb10_11Fixture();
  const listeners = new Map();
  const nativeCalls = [];
  const bridge = {
    status: async () => ({
      backend: "mpv",
      startFullscreen: false,
    }),
    on: (name, callback) => listeners.set(name, callback),
    load: async (request) => {
      nativeCalls.push(["load", request]);
      return true;
    },
    play: async () => nativeCalls.push(["play"]),
    pause: async () => nativeCalls.push(["pause"]),
    stop: async () => nativeCalls.push(["native-stop"]),
    seek: async (seconds) => nativeCalls.push(["seek", seconds]),
    setVolume: async (value) => nativeCalls.push(["volume", value]),
    setMuted: async (value) => nativeCalls.push(["muted", value]),
    setRate: async (value) => nativeCalls.push(["rate", value]),
    setAudioTrack: async (value) => nativeCalls.push(["audio", value]),
    setSubtitleTrack: async (value) => nativeCalls.push(["subtitle", value]),
    setNavigation: async (value) => nativeCalls.push(["navigation", value]),
    setFullscreen: async (value) => nativeCalls.push(["fullscreen", value]),
    focusApp: async () => nativeCalls.push(["focus"]),
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

  assert.equal(supportsJellyfinWebVersion(fixture.version), true);
  const installation = installPlayer({
    serverUrl: "https://media.example/jellyfin",
    backend: "mpv",
    appName: "Noktus",
    appVersion: "test",
    deviceName: "contract-test",
  });
  assert.equal(installation.installed, true);
  assert.deepEqual(global.window.NativeShell.getPlugins(), ["jellyfinDcMpvPlayer"]);
  assert.deepEqual(await global.window.NativeShell.AppHost.init(), {
    deviceName: "contract-test",
    appName: "Noktus",
    appVersion: "test",
  });

  const Player = await global.window.jellyfinDcMpvPlayer();
  const player = new Player(fixture.args);
  const movie = {
    Id: "movie-id",
    Name: "Contract Movie",
    MediaType: "Video",
    RunTimeTicks: 60_000_000,
    Type: "Movie",
  };
  assert.equal(player.canPlayItem(movie, {}), true);
  assert.equal(player.canPlayItem({ ...movie, IsLive: true }, {}), false);
  assert.equal(player.canPlayItem({ ...movie, Type: "LiveTvChannel" }, {}), false);
  assert.equal(player.canPlayItem(movie, { syncPlay: true }), false);

  await player.play({
    url: "https://media.example/jellyfin/Videos/movie-id/stream",
    item: movie,
    mediaSource: {
      DefaultAudioStreamIndex: 2,
      DefaultSubtitleStreamIndex: 3,
      MediaStreams: [
        { Index: 2, Type: "Audio" },
        { Index: 3, Type: "Subtitle" },
      ],
    },
  });
  assert.equal(nativeCalls[0][0], "load");
  assert.equal(nativeCalls[0][1].audioTrack, 1);
  assert.equal(nativeCalls[0][1].subtitleStreamIndex, 3);
  assert.deepEqual(nativeCalls[0][1].subtitleTracks, [
    {
      jellyfinIndex: 3,
      mpvTrack: 1,
      externalUrl: null,
      title: "Subtitle 3",
      language: "",
    },
  ]);

  listeners.get("loaded")({});
  listeners.get("paused")({ value: true });
  listeners.get("paused")({ value: false });
  listeners.get("position")({ value: 12.5 });
  listeners.get("duration")({ value: 60 });
  listeners.get("volume")({ value: 65 });
  listeners.get("muted")({ value: true });
  listeners.get("rate")({ value: 1.25 });
  listeners.get("fullscreen")({ value: true });
  listeners.get("next")({});
  listeners.get("previous")({});
  await new Promise((resolve) => setImmediate(resolve));

  player.pause();
  player.resume();
  player.currentTime(15_000);
  player.setVolume(70);
  player.setMute(false);
  player.setPlaybackRate(1.5);
  player.setFullscreen(false);
  await new Promise((resolve) => setImmediate(resolve));

  const failures = [];
  player._fail = (code, message) => failures.push({ code, message });
  listeners.get("failed")({ code: "process", message: "MPV exited" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(failures, [{ code: "process", message: "MPV exited" }]);

  listeners.get("ended")({});
  assert.equal(player.currentSrc(), null);
  assert.ok(fixture.events.includes("playing"));
  assert.ok(fixture.events.includes("pause"));
  assert.ok(fixture.events.includes("unpause"));
  assert.ok(fixture.events.includes("timeupdate"));
  assert.ok(fixture.events.includes("volumechange"));
  assert.ok(fixture.events.includes("fullscreenchange"));
  assert.ok(fixture.events.includes("stopped"));
  assert.deepEqual(
    fixture.playback.filter(([name]) => ["next", "previous"].includes(name)),
    [],
  );
  assert.ok(
    nativeCalls.some(
      ([name, value]) =>
        name === "navigation" && value.previous === false && value.next === false,
    ),
  );
  assert.ok(nativeCalls.some(([name]) => name === "pause"));
  assert.ok(nativeCalls.some(([name]) => name === "play"));
  assert.ok(nativeCalls.some(([name, value]) => name === "seek" && value === 15));
});
