"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inspectMpvExecutable,
  parseMpvVersionOutput,
} = require("../build/main/playback/mpv-diagnostics");

test("parses release and development MPV version lines", () => {
  assert.deepEqual(parseMpvVersionOutput("mpv 0.40.0 Copyright...\n"), {
    version: "0.40.0",
    versionLine: "mpv 0.40.0 Copyright...",
  });
  assert.deepEqual(parseMpvVersionOutput("mpv v0.41.0-12-gabc123\n"), {
    version: "0.41.0-12-gabc123",
    versionLine: "mpv v0.41.0-12-gabc123",
  });
  assert.equal(parseMpvVersionOutput("not-mpv 1.0"), null);
});

test("reports a runnable MPV executable and its version", async () => {
  const diagnostic = await inspectMpvExecutable("/usr/bin/mpv", "path", {
    configuredPathIgnored: true,
    run: async (executable) => {
      assert.equal(executable, "/usr/bin/mpv");
      return { code: 0, stdout: "mpv 0.40.0\n", stderr: "" };
    },
  });

  assert.deepEqual(diagnostic, {
    available: true,
    executable: "/usr/bin/mpv",
    source: "path",
    version: "0.40.0",
    versionLine: "mpv 0.40.0",
    reason: "",
    configuredPathIgnored: true,
  });
});

test("rejects an executable that is not MPV", async () => {
  const diagnostic = await inspectMpvExecutable("/usr/bin/mpv", "settings", {
    run: async () => ({
      code: 0,
      stdout: "Another program 1.0\n",
      stderr: "",
    }),
  });

  assert.equal(diagnostic.available, false);
  assert.match(diagnostic.reason, /recognizable MPV version/);
});

test("reports process launch and non-zero exit failures", async () => {
  const missing = await inspectMpvExecutable("mpv", "unresolved", {
    run: async () => {
      throw new Error("spawn mpv ENOENT");
    },
  });
  const failed = await inspectMpvExecutable("C:\\tools\\mpv.exe", "settings", {
    run: async () => ({ code: 2, stdout: "", stderr: "broken install\n" }),
  });

  assert.equal(missing.available, false);
  assert.equal(missing.reason, "spawn mpv ENOENT");
  assert.equal(failed.available, false);
  assert.equal(failed.reason, "MPV exited with code 2: broken install");
});

test("does not launch an arbitrary executable from Settings", async () => {
  let launched = false;
  const diagnostic = await inspectMpvExecutable(
    "C:\\Windows\\System32\\notepad.exe",
    "settings",
    {
      run: async () => {
        launched = true;
        return { code: 0, stdout: "mpv 0.40.0\n", stderr: "" };
      },
    },
  );

  assert.equal(launched, false);
  assert.equal(diagnostic.available, false);
  assert.match(diagnostic.reason, /Select the MPV executable/);
});
