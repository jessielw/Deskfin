"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  commonMpvPaths,
  resolveMpvExecutable,
} = require("../build/main/playback/mpv-resolution");

test("ignores an unavailable MPV path from settings", () => {
  const result = resolveMpvExecutable({
    configuredPath: "C:\\missing\\mpv.exe",
    environment: {},
    commonPaths: [],
    pathIsFile: () => false,
  });

  assert.deepEqual(result, {
    executable: "mpv",
    provider: "mpv",
    source: "unresolved",
    ignoredConfiguredPath: "C:\\missing\\mpv.exe",
  });
});

test("uses a valid MPV path from settings", () => {
  const result = resolveMpvExecutable({
    configuredPath: "C:\\tools\\mpv.exe",
    environment: {},
    commonPaths: [],
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

test("discovers MPV on the system PATH before common locations", () => {
  const result = resolveMpvExecutable({
    platform: "linux",
    environment: { PATH: "/usr/local/bin:/custom/bin" },
    commonPaths: ["/opt/mpv/bin/mpv"],
    pathIsFile: (candidate) => candidate === "/custom/bin/mpv",
  });

  assert.deepEqual(result, {
    executable: "/custom/bin/mpv",
    provider: "mpv",
    source: "path",
    ignoredConfiguredPath: null,
  });
});

test("uses a standard install location when MPV is not on PATH", () => {
  const result = resolveMpvExecutable({
    platform: "darwin",
    environment: { PATH: "/usr/bin" },
    commonPaths: ["/Applications/mpv.app/Contents/MacOS/mpv"],
    pathIsFile: (candidate) => candidate === "/Applications/mpv.app/Contents/MacOS/mpv",
  });

  assert.equal(result.executable, "/Applications/mpv.app/Contents/MacOS/mpv");
  assert.equal(result.source, "common");
});

test("handles Windows Path and PATHEXT discovery case-insensitively", () => {
  const result = resolveMpvExecutable({
    platform: "win32",
    environment: {
      Path: "C:\\Windows;D:\\Tools",
      Pathext: ".COM;.EXE",
    },
    commonPaths: [],
    pathIsFile: (candidate) => candidate === "D:\\Tools\\mpv.exe",
  });

  assert.equal(result.executable, "D:\\Tools\\mpv.exe");
  assert.equal(result.source, "path");
});

test("does not select Windows command scripts that cannot be spawned directly", () => {
  const result = resolveMpvExecutable({
    platform: "win32",
    environment: {
      PATH: "C:\\Tools",
      PATHEXT: ".CMD;.BAT",
    },
    commonPaths: [],
    pathIsFile: (candidate) =>
      candidate === "C:\\Tools\\mpv.cmd" || candidate === "C:\\Tools\\mpvnet.bat",
  });

  assert.equal(result.source, "unresolved");
  assert.equal(result.executable, "mpv");
});

test("builds conventional Windows discovery paths from the environment", () => {
  assert.deepEqual(
    commonMpvPaths("win32", {
      LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      USERPROFILE: "C:\\Users\\Test",
    }),
    [
      "C:\\Users\\Test\\AppData\\Local\\Programs\\mpv\\mpv.exe",
      "C:\\Program Files\\mpv\\mpv.exe",
      "C:\\Users\\Test\\scoop\\apps\\mpv\\current\\mpv.exe",
      "C:\\Users\\Test\\AppData\\Local\\Programs\\mpv.net\\mpvnet.exe",
      "C:\\Program Files\\mpv.net\\mpvnet.exe",
      "C:\\Users\\Test\\scoop\\apps\\mpv.net\\current\\mpvnet.exe",
    ],
  );
});

test("prefers regular MPV over mpv.net on Windows PATH", () => {
  const result = resolveMpvExecutable({
    platform: "win32",
    environment: { PATH: "C:\\mpvnet;C:\\mpv" },
    commonPaths: [],
    pathIsFile: (candidate) =>
      candidate === "C:\\mpvnet\\mpvnet.exe" || candidate === "C:\\mpv\\mpv.exe",
  });

  assert.equal(result.executable, "C:\\mpv\\mpv.exe");
  assert.equal(result.provider, "mpv");
});

test("discovers mpv.net when regular MPV is unavailable", () => {
  const result = resolveMpvExecutable({
    platform: "win32",
    environment: { PATH: "C:\\mpvnet" },
    commonPaths: [],
    pathIsFile: (candidate) => candidate === "C:\\mpvnet\\mpvnet.exe",
  });

  assert.equal(result.executable, "C:\\mpvnet\\mpvnet.exe");
  assert.equal(result.provider, "mpv.net");
});

test("skips a Chocolatey mpv.net shim in favor of the real executable", () => {
  const result = resolveMpvExecutable({
    platform: "win32",
    environment: {
      PATH: "C:\\ProgramData\\chocolatey\\bin",
      CHOCOLATEYINSTALL: "C:\\ProgramData\\chocolatey",
    },
    pathIsFile: (candidate) =>
      candidate === "C:\\ProgramData\\chocolatey\\bin\\mpvnet.exe" ||
      candidate ===
        "C:\\ProgramData\\chocolatey\\lib\\mpvnet.portable\\tools\\mpvnet.exe",
  });

  assert.equal(
    result.executable,
    "C:\\ProgramData\\chocolatey\\lib\\mpvnet.portable\\tools\\mpvnet.exe",
  );
  assert.equal(result.provider, "mpv.net");
  assert.equal(result.source, "common");
});

test("resolves a saved Chocolatey mpv.net shim to the real executable", () => {
  const shim = "C:\\ProgramData\\chocolatey\\bin\\mpvnet.exe";
  const executable =
    "C:\\ProgramData\\chocolatey\\lib\\mpvnet.portable\\tools\\mpvnet.exe";
  const result = resolveMpvExecutable({
    platform: "win32",
    configuredPath: shim,
    environment: { CHOCOLATEYINSTALL: "C:\\ProgramData\\chocolatey" },
    pathIsFile: (candidate) => candidate === shim || candidate === executable,
  });

  assert.equal(result.executable, executable);
  assert.equal(result.provider, "mpv.net");
  assert.equal(result.source, "settings");
});
