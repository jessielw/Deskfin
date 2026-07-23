"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDiagnosticsReport } = require("../build/main/diagnostics");

test("creates a support report without leaking embedded secrets", () => {
  const report = createDiagnosticsReport({
    generatedAt: "2026-07-22T12:00:00.000Z",
    application: { name: "Deskfin", version: "test", packaged: false },
    platform: {
      operatingSystem: "win32",
      release: "test",
      architecture: "x64",
    },
    runtime: { electron: "test", chromium: "test", node: "test" },
    playback: {
      mode: "mpv",
      mpvPresentation: "jellyfin",
      startMpvFullscreen: true,
    },
    mpv: {
      available: false,
      version: null,
      source: "settings",
      executableName: "mpv.exe",
      reason: "https://media.example/test?api_key=do-not-copy",
    },
    jellyfin: {
      savedServerCount: 2,
      activeServerVersion: "10.11.0",
      connected: true,
    },
  });

  assert.match(report, /Deskfin diagnostics/);
  assert.match(report, /"savedServerCount": 2/);
  assert.ok(!report.includes("do-not-copy"));
  assert.match(report, /api_key=\[REDACTED\]/);
});
