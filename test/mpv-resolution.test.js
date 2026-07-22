"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveMpvExecutable,
} = require("../build/main/playback/mpv-resolution");

test("ignores an unavailable MPV path from settings", () => {
  const result = resolveMpvExecutable({
    configuredPath: "C:\\missing\\mpv.exe",
    pathIsFile: () => false,
  });

  assert.deepEqual(result, {
    executable: "mpv",
    source: "path",
    ignoredConfiguredPath: "C:\\missing\\mpv.exe",
  });
});

test("uses a valid MPV path from settings", () => {
  const result = resolveMpvExecutable({
    configuredPath: "C:\\tools\\mpv.exe",
    pathIsFile: (candidate) => candidate === "C:\\tools\\mpv.exe",
  });

  assert.equal(result.executable, "C:\\tools\\mpv.exe");
  assert.equal(result.source, "settings");
  assert.equal(result.ignoredConfiguredPath, null);
});

test("keeps an explicit MPV path strict for diagnostics", () => {
  const result = resolveMpvExecutable({
    commandLinePath: "C:\\deliberately-missing\\mpv.exe",
    environmentPath: "C:\\environment\\mpv.exe",
    configuredPath: "C:\\settings\\mpv.exe",
    pathIsFile: () => false,
  });

  assert.equal(result.executable, "C:\\deliberately-missing\\mpv.exe");
  assert.equal(result.source, "command-line");
  assert.equal(result.ignoredConfiguredPath, null);
});
