"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  mainRecoveryMessage,
  rendererRecoveryAction,
  rendererRecoveryPrompt,
  shouldRecoverMainFrameLoadFailure,
} = require("../build/main/runtime-recovery");

test("recovers only actionable main-frame load failures", () => {
  assert.equal(shouldRecoverMainFrameLoadFailure(-105, true, false), true);
  assert.equal(shouldRecoverMainFrameLoadFailure(-3, true, false), false);
  assert.equal(shouldRecoverMainFrameLoadFailure(-105, false, false), false);
  assert.equal(shouldRecoverMainFrameLoadFailure(-105, true, true), false);
});

test("describes server, renderer, and resume recovery without exposing URLs", () => {
  assert.match(mainRecoveryMessage("load-failure"), /could not load/);
  assert.match(mainRecoveryMessage("renderer-crash"), /stopped unexpectedly/);
  assert.match(mainRecoveryMessage("unresponsive"), /stopped responding/);
  assert.equal(
    mainRecoveryMessage("resume", "Check the network."),
    "Noktus could not reconnect to Jellyfin after the computer resumed. Check the network.",
  );
});

test("maps crashed-renderer recovery choices", () => {
  const prompt = rendererRecoveryPrompt(
    "crashed",
    "Reload Noktus or choose another server.",
  );
  assert.deepEqual(prompt.buttons, ["Reload Noktus", "Switch server", "Quit"]);
  assert.equal(rendererRecoveryAction("crashed", 0), "reload");
  assert.equal(rendererRecoveryAction("crashed", 1), "switch-server");
  assert.equal(rendererRecoveryAction("crashed", 2), "quit");
});

test("lets an unresponsive renderer recover without forcing a reload", () => {
  const prompt = rendererRecoveryPrompt(
    "unresponsive",
    "Wait for the page or reload it.",
  );
  assert.deepEqual(prompt.buttons, ["Wait", "Reload Noktus", "Switch server"]);
  assert.equal(rendererRecoveryAction("unresponsive", 0), "wait");
  assert.equal(rendererRecoveryAction("unresponsive", 1), "reload");
  assert.equal(rendererRecoveryAction("unresponsive", 2), "switch-server");
});
