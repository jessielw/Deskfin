"use strict";

const form = document.getElementById("settings-form");
const playbackMode = document.getElementById("playback-mode");
const mpvSettings = document.getElementById("mpv-settings");
const mpvPath = document.getElementById("mpv-path");
const mpvPresentation = document.getElementById("mpv-presentation");
const mpvFullscreen = document.getElementById("mpv-fullscreen");
const browseMpv = document.getElementById("browse-mpv");
const testMpv = document.getElementById("test-mpv");
const mpvDiagnostic = document.getElementById("mpv-diagnostic");
const mpvDiagnosticTitle = document.getElementById("mpv-diagnostic-title");
const mpvDiagnosticDetail = document.getElementById("mpv-diagnostic-detail");
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
  testMpv.disabled = value;
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

function mpvSourceLabel(source) {
  return (
    {
      "command-line": "Command line override",
      environment: "Environment override",
      settings: "Configured executable",
      path: "System PATH",
      common: "Standard install location",
      unresolved: "Not found",
    }[source] || "Detected executable"
  );
}

function renderMpvDiagnostic(diagnostic) {
  if (!diagnostic) {
    mpvDiagnostic.dataset.kind = "pending";
    mpvDiagnosticTitle.textContent = "Player selection not checked";
    mpvDiagnosticDetail.textContent =
      "Use Check Player to verify this executable.";
    return;
  }

  mpvDiagnostic.dataset.kind =
    diagnostic.available && diagnostic.supported
      ? "success"
      : diagnostic.available
        ? "warning"
        : "error";
  mpvDiagnosticTitle.textContent = diagnostic.available
    ? diagnostic.supported
      ? `${diagnostic.provider === "mpv.net" ? "mpv.net" : "MPV"} ${diagnostic.version} is available`
      : `${diagnostic.provider === "mpv.net" ? "mpv.net" : "MPV"} ${diagnostic.version} could not be validated`
    : "MPV player is unavailable";
  const source = `${mpvSourceLabel(diagnostic.source)}: ${diagnostic.executable}`;
  const ignored = diagnostic.configuredPathIgnored
    ? "The saved path was unavailable; Deskfin selected a fallback. "
    : "";
  mpvDiagnosticDetail.textContent = diagnostic.available
    ? `${ignored}${source}${diagnostic.supported ? "" : `. ${diagnostic.reason}`}`
    : `${source}. ${diagnostic.reason}`;
}

async function initialize() {
  try {
    const settings = await window.settingsApi.load();
    playbackMode.value = settings.playbackMode;
    mpvPath.value = settings.mpvPath || "";
    mpvPresentation.value = settings.mpvPresentation;
    mpvFullscreen.checked = settings.startMpvFullscreen;
    renderMpvDiagnostic(settings.mpvDiagnostic);
    version.textContent = `Deskfin ${settings.appVersion}`;
    updateMpvState();
    playbackMode.focus();
  } catch (error) {
    setStatus(`Could not load settings: ${errorMessage(error)}`);
    setBusy(true);
  }
}

playbackMode.addEventListener("change", updateMpvState);
mpvPath.addEventListener("input", () => renderMpvDiagnostic(null));
cancel.addEventListener("click", () => window.close());
browseMpv.addEventListener("click", async () => {
  setStatus("");
  try {
    const selected = await window.settingsApi.browseMpv();
    if (selected) {
      mpvPath.value = selected;
      renderMpvDiagnostic(null);
    }
  } catch (error) {
    setStatus(`Could not select MPV: ${errorMessage(error)}`);
  }
});

testMpv.addEventListener("click", async () => {
  setStatus("Checking player...", "pending");
  setBusy(true);
  try {
    const diagnostic = await window.settingsApi.testMpv(mpvPath.value);
    renderMpvDiagnostic(diagnostic);
    if (diagnostic.available && diagnostic.supported) {
      setStatus(
        `${diagnostic.provider === "mpv.net" ? "mpv.net" : "MPV"} ${diagnostic.version} executable check passed.`,
        "success",
      );
    } else if (diagnostic.available) {
      setStatus(
        `${diagnostic.provider === "mpv.net" ? "mpv.net" : "MPV"} ${diagnostic.version} runs, but ${diagnostic.reason.toLowerCase()}.`,
      );
    } else {
      setStatus(`Player check failed: ${diagnostic.reason}`);
    }
  } catch (error) {
    renderMpvDiagnostic(null);
    setStatus(`Could not check player: ${errorMessage(error)}`);
  } finally {
    setBusy(false);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Saving settings...", "pending");
  setBusy(true);
  try {
    await window.settingsApi.save({
      playbackMode: playbackMode.value,
      mpvPath: mpvPath.value,
      mpvPresentation: mpvPresentation.value,
      startMpvFullscreen: mpvFullscreen.checked,
    });
    setStatus("Settings saved.", "success");
  } catch (error) {
    setStatus(errorMessage(error));
    setBusy(false);
  }
});

initialize();
