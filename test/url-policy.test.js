"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isWithinServer,
  normalizeServerUrl,
  safeJellyfinPageUrl,
  validateMediaUrl,
} = require("../build/shared/url-policy");

test("normalizes Jellyfin web URLs to the server base", () => {
  assert.equal(
    normalizeServerUrl("HTTPS://media.example/jellyfin/web/index.html"),
    "https://media.example/jellyfin",
  );
  assert.equal(normalizeServerUrl("media.example:8096/"), "http://media.example:8096");
});

test("only accepts URLs inside the configured server base path", () => {
  const server = "https://media.example/jellyfin";
  assert.equal(isWithinServer("https://media.example/jellyfin/web/", server), true);
  assert.equal(isWithinServer("https://media.example/other/video", server), false);
  assert.equal(isWithinServer("https://evil.example/jellyfin/video", server), false);
});

test("validates media URLs without accepting credentials or another origin", () => {
  const server = "https://media.example/jellyfin";
  assert.equal(
    validateMediaUrl("https://media.example/jellyfin/Videos/1/stream", server),
    "https://media.example/jellyfin/Videos/1/stream",
  );
  assert.throws(
    () => validateMediaUrl("https://evil.example/jellyfin/Videos/1/stream", server),
    /outside/,
  );
});

test("creates safe links to the current Jellyfin Web route", () => {
  const server = "https://media.example/jellyfin";
  assert.equal(
    safeJellyfinPageUrl(
      "https://media.example/jellyfin/web/#/details?id=movie-id&serverId=server-id",
      server,
    ),
    "https://media.example/jellyfin/web/#/details?id=movie-id&serverId=server-id",
  );
});

test("removes credentials and token parameters from Jellyfin page links", () => {
  const server = "https://media.example/jellyfin";
  assert.equal(
    safeJellyfinPageUrl(
      "https://user:password@media.example/jellyfin/web/?api_key=query-secret&theme=dark#/details?id=movie-id&X-Emby-Token=hash-secret&X-Emby-Authorization=hash-auth&X-MediaBrowser-Token=hash-token&serverId=server-id",
      server,
    ),
    "https://media.example/jellyfin/web/?theme=dark#/details?id=movie-id&serverId=server-id",
  );
  assert.equal(
    safeJellyfinPageUrl(
      "https://media.example/jellyfin/web/#access_token=secret&id=movie-id",
      server,
    ),
    "https://media.example/jellyfin/web/#id=movie-id",
  );
});

test("rejects unsafe current-page links", () => {
  const server = "https://media.example/jellyfin";
  assert.throws(
    () =>
      safeJellyfinPageUrl(
        "https://evil.example/jellyfin/web/#/details?id=movie-id",
        server,
      ),
    /outside/,
  );
  assert.throws(() => safeJellyfinPageUrl("not a URL", server), /outside/);
});
