"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  formatLogValues,
  redactSensitive,
  RotatingFileLogger,
} = require("../build/main/logging");

test("redacts Jellyfin tokens, authorization headers, and URL credentials", () => {
  const source = [
    "https://media.example/Videos/1?api_key=secret-one&start=4",
    '"AccessToken":"secret-two"',
    "Authorization: Bearer secret-three",
    "X-Emby-Token: secret-four",
    "https://user:secret-five@media.example/web/",
  ].join("\n");
  const redacted = redactSensitive(source);

  for (const secret of ["one", "two", "three", "four", "five"]) {
    assert.ok(!redacted.includes(`secret-${secret}`));
  }
  assert.match(redacted, /api_key=\[REDACTED\]/);
  assert.match(redacted, /Authorization: Bearer \[REDACTED\]/);
});

test("formats structured values and errors before redaction", () => {
  const message = formatLogValues([
    "Request failed",
    { api_key: "hidden", status: 500 },
    new Error("token=also-hidden"),
  ]);

  assert.match(message, /Request failed/);
  assert.match(message, /status: 500/);
  assert.ok(!message.includes("also-hidden"));
  assert.ok(!message.includes("hidden"));
});

test("rotates bounded log files and never writes secrets", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deskfin-logs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logger = new RotatingFileLogger(directory, {
    maxBytes: 220,
    maxFiles: 3,
    now: () => new Date("2026-07-22T12:00:00.000Z"),
  });

  for (let index = 0; index < 12; index += 1) {
    logger.write("INFO", [
      `entry-${index}`,
      `https://media.example/video?api_key=secret-${index}`,
    ]);
  }

  const files = fs
    .readdirSync(directory)
    .filter((file) => file.startsWith("deskfin.log"));
  const contents = files
    .map((file) => fs.readFileSync(path.join(directory, file), "utf8"))
    .join("\n");
  assert.ok(files.length <= 3);
  assert.match(contents, /\[REDACTED\]/);
  assert.ok(!contents.includes("secret-"));
});
