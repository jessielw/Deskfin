"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MpvController,
  buildMpvArguments,
  normalizeLoadRequest,
  normalizeMpvPresentation,
} = require("../build/main/playback/mpv-controller");

test("normalizes a constrained MPV load request", () => {
  const request = normalizeLoadRequest(
    {
      url: "https://media.example/jellyfin/Videos/1/stream?api_key=secret",
      startSeconds: 12.5,
      title: "Example",
      fullscreen: false,
      audioTrack: 2,
      subtitleTrack: 0,
    },
    "https://media.example/jellyfin",
  );

  assert.equal(request.startSeconds, 12.5);
  assert.equal(request.audioTrack, 2);
  assert.equal(request.fullscreen, false);
});

test("rejects unsafe MPV input", () => {
  assert.throws(
    () =>
      normalizeLoadRequest(
        { url: "file:///etc/passwd" },
        "https://media.example",
      ),
    /outside/,
  );
  assert.throws(
    () =>
      normalizeLoadRequest(
        {
          url: "https://media.example/Videos/1/stream",
          startSeconds: -1,
        },
        "https://media.example",
      ),
    /startSeconds/,
  );
});

test("forwards observed MPV fullscreen state", () => {
  const events = [];
  const controller = new MpvController({
    serverUrl: "https://media.example",
    eventSink: (name, payload) => events.push({ name, payload }),
  });

  controller.onMessage({
    event: "property-change",
    name: "fullscreen",
    data: true,
  });

  assert.deepEqual(events, [{ name: "fullscreen", payload: { value: true } }]);
});

test("distinguishes natural completion and user quit", () => {
  const events = [];
  const controller = new MpvController({
    serverUrl: "https://media.example",
    eventSink: (name, payload) => events.push({ name, payload }),
  });

  controller.current = true;
  controller.onMessage({ event: "end-file", reason: "eof" });
  controller.current = true;
  controller.onMessage({ event: "end-file", reason: "quit" });

  assert.deepEqual(events, [
    { name: "ended", payload: {} },
    { name: "quit", payload: {} },
  ]);
});

test("reports an unexpected MPV process exit as a failure", () => {
  const events = [];
  const controller = new MpvController({
    serverUrl: "https://media.example",
    eventSink: (name, payload) => events.push({ name, payload }),
  });
  const child = {};
  controller.child = child;
  controller.current = true;

  controller.onProcessExit(child, 7, null);

  assert.deepEqual(events, [
    { name: "ready", payload: { ready: false } },
    {
      name: "failed",
      payload: { code: "process", message: "MPV exited unexpectedly (7)" },
    },
  ]);
});

test("forwards Jellyfin controls and native track changes from MPV", () => {
  const events = [];
  const controller = new MpvController({
    serverUrl: "https://media.example",
    eventSink: (name, payload) => events.push({ name, payload }),
  });

  controller.onMessage({
    event: "client-message",
    args: ["jellyfin-dc-control", "next"],
  });
  controller.onMessage({ event: "property-change", name: "aid", data: 2 });
  controller.onMessage({ event: "property-change", name: "sid", data: false });

  assert.deepEqual(events, [
    { name: "next", payload: {} },
    { name: "audioTrack", payload: { value: 2 } },
    { name: "subtitleTrack", payload: { value: false } },
  ]);
});

test("adds the Jellyfin OSC preset without discarding other MPV script options", () => {
  const args = buildMpvArguments("test-ipc", "jellyfin", "jellyfin_dc.lua");

  assert.ok(args.includes("--force-window=immediate"));
  assert.ok(!args.includes("--force-window=no"));
  assert.ok(args.includes("--osc=yes"));
  assert.ok(args.includes("--osd-on-seek=msg-bar"));
  assert.ok(
    args.some((argument) =>
      argument.startsWith("--script-opts-append=osc-layout="),
    ),
  );
  assert.ok(args.includes("--script-opts-append=osc-timetotal=yes"));
  assert.equal(
    args.filter((argument) => argument.startsWith("--script-opts-append="))
      .length,
    8,
  );
  assert.ok(!args.some((argument) => argument.startsWith("--script-opts=")));
  assert.ok(args.includes("--script=jellyfin_dc.lua"));
});

test("cleans up a lost MPV IPC connection before another load", () => {
  const controller = new MpvController({ serverUrl: "https://media.example" });
  const child = { exitCode: null, kill: () => {} };
  const socket = { destroy: () => {}, destroyed: false };
  controller.child = child;
  controller.socket = socket;

  controller.onSocketFailure(socket, new Error("MPV IPC failed: write EPIPE"));

  assert.equal(controller.child, null);
  assert.equal(controller.socket, null);
  assert.match(controller.status().reason, /EPIPE/);
});

test("restarts MPV once when a load loses its IPC connection", async () => {
  const controller = new MpvController({ serverUrl: "https://media.example" });
  const request = {
    url: "https://media.example/Videos/1/stream",
    startSeconds: 0,
    title: "Example",
    fullscreen: false,
    audioTrack: 0,
    subtitleTrack: 0,
  };
  let attempts = 0;
  let teardownCalls = 0;
  controller.loadRequest = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("write EPIPE");
    return true;
  };
  controller.teardownConnection = () => {
    teardownCalls += 1;
  };

  await controller.load(request);

  assert.equal(attempts, 2);
  assert.equal(teardownCalls, 1);
});

test("lets user MPV configuration own the presentation", () => {
  const args = buildMpvArguments("test-ipc", "user");

  assert.ok(!args.includes("--osc=yes"));
  assert.ok(!args.some((argument) => argument.startsWith("--script-opts")));
  assert.equal(normalizeMpvPresentation("USER"), "user");
  assert.throws(() => normalizeMpvPresentation("overlay"), /mpv-ui/);
});

test("uses OSD-aware commands for remote playback changes", async () => {
  const commands = [];
  const controller = new MpvController({ serverUrl: "https://media.example" });
  controller.ensureStarted = async () => {};
  controller.command = async (command) => {
    commands.push(command);
  };

  await controller.execute("seek", 42.5);
  await controller.execute("volume", 73);
  await controller.execute("rate", 1.25);
  await controller.execute("muted", true);
  await controller.execute("subtitleTrack", 0);

  assert.deepEqual(commands, [
    ["osd-auto", "seek", "42.5", "absolute"],
    ["osd-auto", "set", "volume", "73"],
    ["osd-auto", "set", "speed", "1.25"],
    ["osd-auto", "set", "mute", "yes"],
    ["osd-auto", "set", "sid", "no"],
  ]);
});
