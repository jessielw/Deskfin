"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  WINDOW_STATE_VERSION,
  loadWindowState,
  normalizeWindowState,
  resolveWindowState,
  saveWindowState,
} = require("../build/main/window-state");

const limits = { minWidth: 640, minHeight: 480 };

function state(bounds, overrides = {}) {
  return {
    version: WINDOW_STATE_VERSION,
    bounds,
    maximized: false,
    fullscreen: false,
    ...overrides,
  };
}

test("normalizes valid window state and rejects invalid geometry", () => {
  assert.deepEqual(
    normalizeWindowState(
      state(
        { x: 10.4, y: 20.6, width: 1000.2, height: 700.8 },
        { maximized: true, fullscreen: true },
      ),
    ),
    state(
      { x: 10, y: 21, width: 1000, height: 701 },
      { maximized: true, fullscreen: true },
    ),
  );
  assert.equal(
    normalizeWindowState(state({ x: 0, y: 0, width: 0, height: 700 })),
    null,
  );
  assert.equal(
    normalizeWindowState({
      ...state({ x: 0, y: 0, width: 1000, height: 700 }),
      version: 999,
    }),
    null,
  );
});

test("restores intersecting bounds within the best matching display", () => {
  const saved = state(
    { x: 1800, y: -100, width: 900, height: 1400 },
    { maximized: true },
  );
  const resolved = resolveWindowState(
    saved,
    [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: 1920, y: 0, width: 1920, height: 1040 },
    ],
    limits,
  );

  assert.deepEqual(resolved, {
    ...saved,
    bounds: { x: 1920, y: 0, width: 900, height: 1040 },
  });
});

test("does not restore bounds from a disconnected display", () => {
  assert.equal(
    resolveWindowState(
      state({ x: 3000, y: 200, width: 1000, height: 700 }),
      [{ x: 0, y: 0, width: 1920, height: 1040 }],
      limits,
    ),
    null,
  );
});

test("enforces the minimum size while keeping the window on screen", () => {
  const resolved = resolveWindowState(
    state({ x: 1800, y: 900, width: 200, height: 100 }),
    [{ x: 0, y: 0, width: 1920, height: 1040 }],
    limits,
  );

  assert.deepEqual(resolved?.bounds, {
    x: 1280,
    y: 560,
    width: 640,
    height: 480,
  });
});

test("round trips window state through its own JSON file", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noktus-window-state-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "window-state.json");
  const saved = state(
    { x: -1200, y: 80, width: 1100, height: 760 },
    { fullscreen: true },
  );

  assert.deepEqual(saveWindowState(filePath, saved), saved);
  assert.deepEqual(loadWindowState(filePath), saved);
});

test("recovers from malformed window state without failing startup", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noktus-window-state-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "window-state.json");
  const warnings = [];
  fs.writeFileSync(filePath, "{invalid", "utf8");

  assert.equal(
    loadWindowState(filePath, {
      logger: { warn: (...values) => warnings.push(values) },
    }),
    null,
  );
  assert.equal(warnings.length, 1);
});
