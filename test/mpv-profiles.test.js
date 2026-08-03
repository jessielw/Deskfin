"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  discoverMpvProfiles,
  parseMpvProfileOutput,
} = require("../build/main/playback/mpv-profiles");
const { normalizeMpvProfile } = require("../build/shared/mpv-profile");

test("parses selectable MPV profiles and ignores automatic profiles", () => {
  assert.deepEqual(
    parseMpvProfileOutput(
      `noise\nAvailable profiles:\n    high-quality    Better rendering\n    anime\n    extension.mkv\n    protocol.http\n    default\n`,
    ),
    [
      { name: "anime", description: "" },
      { name: "high-quality", description: "Better rendering" },
    ],
  );
});

test("discovers profiles without treating empty output as fatal", async () => {
  const found = await discoverMpvProfiles("mpv", {
    run: async () => ({
      code: 0,
      stdout: "Available profiles:\n    cinema    Living room display\n",
      stderr: "",
    }),
  });
  assert.deepEqual(found, {
    profiles: [{ name: "cinema", description: "Living room display" }],
    reason: "",
  });

  const empty = await discoverMpvProfiles("mpv", {
    run: async () => ({ code: 0, stdout: "Available profiles:\n", stderr: "" }),
  });
  assert.equal(empty.profiles.length, 0);
  assert.match(empty.reason, /did not report/i);
});

test("does not launch mpv.net for profile discovery", async () => {
  let launched = false;
  const result = await discoverMpvProfiles("C:\\tools\\mpvnet.exe", {
    run: async () => {
      launched = true;
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(launched, false);
  assert.match(result.reason, /manually/i);
});

test("does not launch an arbitrary executable for profile discovery", async () => {
  let launched = false;
  const result = await discoverMpvProfiles("C:\\tools\\player.exe", {
    run: async () => {
      launched = true;
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(launched, false);
  assert.match(result.reason, /select an MPV/i);
});

test("accepts one bounded profile name", () => {
  assert.equal(normalizeMpvProfile(" cinema "), "cinema");
  assert.equal(normalizeMpvProfile(""), undefined);
  assert.throws(() => normalizeMpvProfile("cinema,fast"), /unsupported/);
  assert.throws(() => normalizeMpvProfile("bad\nname"), /unsupported/);
});
