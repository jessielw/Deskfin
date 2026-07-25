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
  assert.deepEqual(
    parseMpvVersionOutput(
      "[mpv.net] warning before version\nmpv.net v7.1.2.0\n",
      "mpv.net",
    ),
    {
      version: "7.1.2.0",
      versionLine: "mpv.net v7.1.2.0",
    },
  );
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
    supported: true,
    provider: "mpv",
    executable: "/usr/bin/mpv",
    source: "path",
    version: "0.40.0",
    versionLine: "mpv 0.40.0",
    reason: "",
    configuredPathIgnored: true,
  });
});

test("finds the version when an executable writes other output to stdout", async () => {
  const diagnostic = await inspectMpvExecutable("mpv", "path", {
    run: async () => ({
      code: 0,
      stdout: "unrelated startup notice\n",
      stderr: "mpv 0.40.0\n",
    }),
  });

  assert.equal(diagnostic.available, true);
  assert.equal(diagnostic.version, "0.40.0");
});

test("validates mpv.net with its own version format without starting playback", async () => {
  const diagnostic = await inspectMpvExecutable(
    "C:\\tools\\mpvnet.exe",
    "settings",
    {
      platform: "win32",
      run: async () => ({ code: 0, stdout: "mpv.net v7.1.2.0\n", stderr: "" }),
    },
  );

  assert.equal(diagnostic.provider, "mpv.net");
  assert.equal(diagnostic.available, true);
  assert.equal(diagnostic.supported, true);
});

test("rejects mpv.net outside Windows", async () => {
  const diagnostic = await inspectMpvExecutable("/opt/mpvnet.exe", "settings", {
    platform: "linux",
    run: async () => ({ code: 0, stdout: "mpv.net v7.1.2.0\n", stderr: "" }),
  });

  assert.equal(diagnostic.available, false);
  assert.match(diagnostic.reason, /only supported on Windows/);
});

test("reports runnable MPV versions below the supported floor", async () => {
  const diagnostic = await inspectMpvExecutable("mpv", "path", {
    run: async () => ({ code: 0, stdout: "mpv 0.36.0\n", stderr: "" }),
  });

  assert.equal(diagnostic.available, true);
  assert.equal(diagnostic.supported, false);
  assert.match(diagnostic.reason, /0\.37\.0 or newer/);
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

test("rejects the Chocolatey mpv.net launcher shim with an actionable reason", async () => {
  let launched = false;
  const diagnostic = await inspectMpvExecutable(
    "C:\\ProgramData\\chocolatey\\bin\\mpvnet.exe",
    "settings",
    {
      platform: "win32",
      run: async () => {
        launched = true;
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  );

  assert.equal(launched, false);
  assert.equal(diagnostic.available, false);
  assert.match(diagnostic.reason, /Chocolatey's mpv\.net launcher shim/);
});
