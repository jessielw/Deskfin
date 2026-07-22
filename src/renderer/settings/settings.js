"use strict";

const form = document.getElementById("settings-form");
const playbackMode = document.getElementById("playback-mode");
const mpvSettings = document.getElementById("mpv-settings");
const mpvPath = document.getElementById("mpv-path");
const mpvPresentation = document.getElementById("mpv-presentation");
const mpvFullscreen = document.getElementById("mpv-fullscreen");
const browseMpv = document.getElementById("browse-mpv");
const cancel = document.getElementById("cancel");
const save = document.getElementById("save");
const status = document.getElementById("status");
const version = document.getElementById("version");

function updateMpvState() {
  mpvSettings.classList.toggle("inactive", playbackMode.value !== "mpv");
}

function setBusy(value) {
  save.disabled = value;
  cancel.disabled = value;
  browseMpv.disabled = value;
}

function setStatus(message, kind = "error") {
  status.textContent = message;
  status.dataset.kind = message ? kind : "";
}

function errorMessage(error) {
  return String(error?.message || error).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
}

async function initialize() {
  try {
    const settings = await window.settingsApi.load();
    playbackMode.value = settings.playbackMode;
    mpvPath.value = settings.mpvPath || "";
    mpvPresentation.value = settings.mpvPresentation;
    mpvFullscreen.checked = settings.startMpvFullscreen;
    version.textContent = `Deskfin ${settings.appVersion}`;
    updateMpvState();
    playbackMode.focus();
  } catch (error) {
    setStatus(`Could not load settings: ${errorMessage(error)}`);
    setBusy(true);
  }
}

playbackMode.addEventListener("change", updateMpvState);
cancel.addEventListener("click", () => window.close());
browseMpv.addEventListener("click", async () => {
  setStatus("");
  try {
    const selected = await window.settingsApi.browseMpv();
    if (selected) mpvPath.value = selected;
  } catch (error) {
    setStatus(`Could not select MPV: ${errorMessage(error)}`);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Checking Jellyfin server...", "pending");
  setBusy(true);
  try {
    await window.settingsApi.save({
      playbackMode: playbackMode.value,
      mpvPath: mpvPath.value,
      mpvPresentation: mpvPresentation.value,
      startMpvFullscreen: mpvFullscreen.checked,
    });
    setStatus("Connected. Opening Jellyfin...", "success");
  } catch (error) {
    setStatus(errorMessage(error));
    setBusy(false);
  }
});

initialize();
