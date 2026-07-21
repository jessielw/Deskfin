"use strict";

const { MpvController } = require("../build/main/playback/mpv-controller");

async function main() {
  const events = [];
  const controller = new MpvController({
    serverUrl: "http://127.0.0.1:8096",
    executable: process.env.MPV_PATH || "mpv",
    eventSink: (name, payload) => events.push({ name, payload }),
  });

  try {
    await controller.ensureStarted();
    if (!controller.status().ready) throw new Error("MPV did not report ready");
    await controller.execute("volume", 50);
    await controller.execute("muted", true);
    await controller.execute("muted", false);
    await controller.command(["keypress", ">"]);
    await controller.command(["keypress", "<"]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await controller.execute("fullscreen", true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await controller.execute("fullscreen", false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const fullscreenValues = events
      .filter((event) => event.name === "fullscreen")
      .map((event) => event.payload.value);
    if (!fullscreenValues.includes(true) || !fullscreenValues.includes(false)) {
      throw new Error(
        `MPV fullscreen observation failed: ${JSON.stringify(fullscreenValues)}`,
      );
    }
    if (!events.some((event) => event.name === "next")) {
      throw new Error(
        `MPV next-item binding failed: ${JSON.stringify(events)}`,
      );
    }
    if (!events.some((event) => event.name === "previous")) {
      throw new Error(
        `MPV previous-item binding failed: ${JSON.stringify(events)}`,
      );
    }
    console.log(
      `[Deskfin] MPV IPC is ready via ${controller.status().executable}`,
    );
    console.log("[Deskfin] MPV fullscreen state is synchronized");
    console.log("[Deskfin] MPV native OSD commands are accepted");
    console.log("[Deskfin] MPV-to-Jellyfin control messages are accepted");
  } finally {
    controller.close();
  }
  
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
