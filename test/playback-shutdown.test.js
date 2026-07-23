"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PlaybackShutdownCoordinator,
} = require("../build/main/playback/playback-shutdown");

test("waits for the matching renderer to acknowledge playback shutdown", async () => {
  const coordinator = new PlaybackShutdownCoordinator(100);
  let request;
  const waiting = coordinator.request(42, "server-switch", (value) => {
    request = value;
  });

  assert.equal(coordinator.acknowledge(7, request.requestId), false);
  assert.equal(coordinator.acknowledge(42, "another-request"), false);
  assert.equal(coordinator.acknowledge(42, request.requestId), true);
  assert.equal(await waiting, true);
  assert.equal(request.reason, "server-switch");
});

test("bounds shutdown waiting with a timeout", async () => {
  const coordinator = new PlaybackShutdownCoordinator(5);
  const acknowledged = await coordinator.request(42, "quit", () => {});

  assert.equal(acknowledged, false);
});

test("shares an in-flight shutdown request", async () => {
  const coordinator = new PlaybackShutdownCoordinator(100);
  let firstRequest;
  let sends = 0;
  const first = coordinator.request(42, "window-close", (value) => {
    sends += 1;
    firstRequest = value;
  });
  const second = coordinator.request(42, "quit", () => {
    sends += 1;
  });

  assert.equal(first, second);
  assert.equal(sends, 1);
  coordinator.acknowledge(42, firstRequest.requestId);
  assert.equal(await second, true);
});

test("resolves immediately when sending to the renderer fails", async () => {
  const coordinator = new PlaybackShutdownCoordinator(100);
  const acknowledged = await coordinator.request(42, "quit", () => {
    throw new Error("renderer unavailable");
  });

  assert.equal(acknowledged, false);
});
