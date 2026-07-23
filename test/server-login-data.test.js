"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  clearServerLoginData,
  profilesSharingOrigin,
  serverOrigin,
} = require("../build/main/server-login-data");

test("uses the HTTP origin rather than a Jellyfin base path", () => {
  assert.equal(
    serverOrigin("https://media.example:8443/jellyfin"),
    "https://media.example:8443",
  );
});

test("finds profiles whose browser login storage shares an origin", () => {
  const profiles = [
    {
      id: "one",
      name: "One",
      url: "https://media.example/one",
    },
    {
      id: "two",
      name: "Two",
      url: "https://media.example/two",
    },
    {
      id: "three",
      name: "Three",
      url: "https://other.example",
    },
  ];

  assert.deepEqual(
    profilesSharingOrigin(profiles, profiles[0]).map((profile) => profile.id),
    ["one", "two"],
  );
});

test("clears only login-bearing storage for the selected origin", async () => {
  let received = null;
  await clearServerLoginData(
    {
      clearStorageData: async (options) => {
        received = options;
      },
    },
    "https://media.example/jellyfin",
  );

  assert.deepEqual(received, {
    origin: "https://media.example",
    storages: [
      "cookies",
      "filesystem",
      "indexdb",
      "localstorage",
      "serviceworkers",
      "cachestorage",
    ],
  });
});
