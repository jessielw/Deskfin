"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateJellyfinServer } = require("../build/main/server-health");

function response({ status = 200, url, contentType = "application/json", body = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ "content-type": contentType }),
    json: async () => body,
  };
}

function publicInfo(overrides = {}) {
  return {
    ProductName: "Jellyfin Server",
    ServerName: "Living Room",
    Version: "10.11.0",
    Id: "server-id",
    ...overrides,
  };
}

test("validates Jellyfin identity and its hosted Web interface", async () => {
  const requests = [];
  const responses = [
    response({
      url: "https://media.example/jellyfin/System/Info/Public",
      body: publicInfo(),
    }),
    response({
      url: "https://media.example/jellyfin/web/",
      contentType: "text/html; charset=utf-8",
    }),
  ];
  const health = await validateJellyfinServer("https://media.example/jellyfin/web/", {
    fetchImpl: async (url) => {
      requests.push(url);
      return responses.shift();
    },
  });

  assert.deepEqual(requests, [
    "https://media.example/jellyfin/System/Info/Public",
    "https://media.example/jellyfin/web/",
  ]);
  assert.deepEqual(health, {
    serverId: "server-id",
    serverUrl: "https://media.example/jellyfin",
    serverName: "Living Room",
    version: "10.11.0",
  });
});

test("uses the canonical server URL after a valid redirect", async () => {
  const requests = [];
  const responses = [
    response({
      url: "https://media.example/jellyfin/System/Info/Public",
      body: publicInfo(),
    }),
    response({
      url: "https://media.example/jellyfin/web/",
      contentType: "text/html",
    }),
  ];
  const health = await validateJellyfinServer("http://media.example/jellyfin", {
    fetchImpl: async (url) => {
      requests.push(url);
      return responses.shift();
    },
  });

  assert.equal(health.serverUrl, "https://media.example/jellyfin");
  assert.equal(requests[1], "https://media.example/jellyfin/web/");
});

test("rejects a successful response that is not Jellyfin", async () => {
  await assert.rejects(
    validateJellyfinServer("https://media.example", {
      fetchImpl: async (url) =>
        response({ url, body: { ProductName: "Another Server", Id: "id" } }),
    }),
    /does not appear to be a Jellyfin server/,
  );
});

test("reports network failures without exposing a blank browser window", async () => {
  await assert.rejects(
    validateJellyfinServer("https://missing.example", {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }),
    /Could not reach the Jellyfin server/,
  );
});

test("reports a bounded timeout for an unresponsive server", async () => {
  await assert.rejects(
    validateJellyfinServer("https://slow.example", {
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("net::ERR_ABORTED")));
        }),
    }),
    /did not respond within 1 seconds/,
  );
});

test("requires the server-hosted Jellyfin Web interface", async () => {
  const responses = [
    response({
      url: "https://media.example/System/Info/Public",
      body: publicInfo(),
    }),
    response({
      url: "https://media.example/web/",
      status: 404,
      contentType: "text/html",
    }),
  ];
  await assert.rejects(
    validateJellyfinServer("https://media.example", {
      fetchImpl: async () => responses.shift(),
    }),
    /No Jellyfin Web interface was found/,
  );
});
