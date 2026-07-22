"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isWithinServer,
  normalizeServerUrl,
  validateMediaUrl,
} = require("../build/shared/url-policy");

test("normalizes Jellyfin web URLs to the server base", () => {
  assert.equal(
    normalizeServerUrl("HTTPS://media.example/jellyfin/web/index.html"),
    "https://media.example/jellyfin",
  );
  assert.equal(
    normalizeServerUrl("media.example:8096/"),
    "http://media.example:8096",
  );
});

test("only accepts URLs inside the configured server base path", () => {
  const server = "https://media.example/jellyfin";
  assert.equal(
    isWithinServer("https://media.example/jellyfin/web/", server),
    true,
  );
  assert.equal(
    isWithinServer("https://media.example/other/video", server),
    false,
  );
  assert.equal(
    isWithinServer("https://evil.example/jellyfin/video", server),
    false,
  );
});

test("validates media URLs without accepting credentials or another origin", () => {
  const server = "https://media.example/jellyfin";
  assert.equal(
    validateMediaUrl("https://media.example/jellyfin/Videos/1/stream", server),
    "https://media.example/jellyfin/Videos/1/stream",
  );
  assert.throws(
    () =>
      validateMediaUrl("https://evil.example/jellyfin/Videos/1/stream", server),
    /outside/,
  );
});
