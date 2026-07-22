import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
  type Rectangle,
} from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MpvController,
  normalizeMpvPresentation,
} from "./playback/mpv-controller";
import { resolveMpvExecutable } from "./playback/mpv-resolution";
import {
  validateJellyfinServer,
  type JellyfinServerHealth,
} from "./server-health";
import {
  resolveMpvIntegrationScript,
  resolvePreloadPath,
  resolveSettingsPagePath,
  resolveSettingsPreloadPath,
  resolveServersPagePath,
  resolveServersPreloadPath,
} from "./runtime-paths";
import {
  activeServer,
  loadSettings,
  normalizeSettings,
  removeServer,
  saveSettings,
  upsertServer,
} from "../shared/settings";
import { isWithinServer, normalizeServerUrl } from "../shared/url-policy";
import type {
  AppSettings,
  MpvEventName,
  MpvEventPayload,
  MpvPresentation,
  PlaybackMode,
  SaveServerRequest,
  ServerManagerSnapshot,
  ServerProfile,
  SettingsSnapshot,
} from "../shared/types";

const APP_NAME = "Deskfin";
const LOG_PREFIX = `[${APP_NAME}]`;
const isPrimaryInstance = app.requestSingleInstanceLock();
const smokeSwitch = process.argv.includes("--smoke-switch");
const smokeSettings = process.argv.includes("--smoke-settings");
const smokeServers = process.argv.includes("--smoke-servers");
const smokeServerFailure = process.argv.includes("--smoke-server-failure");

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let serversWindow: BrowserWindow | null = null;
let mpvController: MpvController | null = null;
let mpvControllerStale = false;
let quitting = false;
let switchPromise: Promise<void> | null = null;
let currentMode: PlaybackMode = "web";
let serverUrl: string | null = null;
let startupError: Error | null = null;
let connectionError: string | null = null;
let mpvExecutable = "mpv";
let mpvIntegrationScript: string | null = null;
let mpvPresentation: MpvPresentation = "jellyfin";
let startMpvFullscreen = true;
let preloadPath: string | null = null;
let settingsPagePath: string | null = null;
let settingsPreloadPath: string | null = null;
let serversPagePath: string | null = null;
let serversPreloadPath: string | null = null;
let settingsPath: string | null = null;
let persistedSettings: AppSettings = normalizeSettings();
let serverStatusMessage: string | null = null;

if (!isPrimaryInstance) app.quit();

interface PersistRuntimeOptions {
  includeMode?: boolean;
  includeFullscreen?: boolean;
  includePresentation?: boolean;
}

interface CreateWindowOptions {
  mode?: PlaybackMode;
  targetUrl?: string;
  showWhenReady?: boolean;
  bounds?: Rectangle | null;
}

interface CreatedWindow {
  window: BrowserWindow;
  ready: Promise<void>;
}

interface SettingsSmokeReport {
  title: string;
  hasForm: boolean;
  hasMpvPath: boolean;
  hasBridge: boolean;
  playbackMode: unknown;
}

interface ServerFailureSmokeReport {
  hasBridge: boolean;
  connectionError?: string;
}

interface ServersSmokeReport {
  title: string;
  hasForm: boolean;
  hasServerUrl: boolean;
  hasBridge: boolean;
  hasServerList: boolean;
}

interface SenderEvent {
  senderFrame?: { url: string } | null;
  sender?: { getURL(): string };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requiredPath(value: string | null, label: string): string {
  if (!value) throw new Error(`${label} has not been initialized`);
  return value;
}

function isPlaybackMode(value: unknown): value is PlaybackMode {
  return value === "web" || value === "mpv";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function focusExistingInstance(): void {
  const candidates = [
    BrowserWindow.getFocusedWindow(),
    serversWindow,
    settingsWindow,
    mainWindow,
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate.isDestroyed()) continue;
    if (candidate.isMinimized()) candidate.restore();
    if (!candidate.isVisible()) continue;
    candidate.show();
    candidate.focus();
    return;
  }

  // A hidden window may still be loading. Its normal ready handler will show it
  // without exposing a blank renderer.
  if (candidates.some((candidate) => candidate && !candidate.isDestroyed())) {
    return;
  }
  if (!app.isReady()) return;
  if (serverUrl) openMainWindow();
  else showServersWindow();
}

function commandLineOption(name: string): string | null {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument?.startsWith(prefix)) return argument.slice(prefix.length);
    if (argument === exact) return process.argv[index + 1] || "";
  }
  return null;
}

function persistRuntimeSettings({
  includeMode = true,
  includeFullscreen = true,
  includePresentation = true,
}: PersistRuntimeOptions = {}): void {
  if (!settingsPath) return;
  try {
    const nextSettings = { ...persistedSettings };
    if (includeMode) nextSettings.playbackMode = currentMode;
    if (includeFullscreen) nextSettings.startMpvFullscreen = startMpvFullscreen;
    if (includePresentation) nextSettings.mpvPresentation = mpvPresentation;
    persistedSettings = saveSettings(settingsPath, nextSettings);
  } catch (error) {
    console.warn(
      `${LOG_PREFIX} Could not save settings ${settingsPath}:`,
      errorMessage(error),
    );
  }
}

function refreshMpvExecutable(): void {
  const resolution = resolveMpvExecutable({
    commandLinePath: commandLineOption("mpv-path"),
    environmentPath: process.env.MPV_PATH,
    configuredPath: persistedSettings.mpvPath,
  });
  mpvExecutable = resolution.executable;
  if (resolution.ignoredConfiguredPath) {
    console.warn(
      `${LOG_PREFIX} Configured MPV executable is unavailable; using mpv from PATH:`,
      resolution.ignoredConfiguredPath,
    );
  }
}

function initializeRuntime(): void {
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  persistedSettings = loadSettings(settingsPath);
  const rawServerUrl =
    commandLineOption("server-url") ||
    process.env.JELLYFIN_DC_SERVER_URL ||
    activeServer(persistedSettings)?.url;
  const modeOverride =
    commandLineOption("mode") || process.env.JELLYFIN_DC_MODE;
  const requestedMode = modeOverride || persistedSettings.playbackMode;
  const requestedMpvFullscreen = commandLineOption("mpv-fullscreen");
  const presentationOverride =
    commandLineOption("mpv-ui") || process.env.JELLYFIN_DC_MPV_UI;
  const requestedMpvPresentation =
    presentationOverride || persistedSettings.mpvPresentation;

  preloadPath = resolvePreloadPath(app.getAppPath());
  settingsPagePath = resolveSettingsPagePath(app.getAppPath());
  settingsPreloadPath = resolveSettingsPreloadPath(app.getAppPath());
  serversPagePath = resolveServersPagePath(app.getAppPath());
  serversPreloadPath = resolveServersPreloadPath(app.getAppPath());
  mpvIntegrationScript = resolveMpvIntegrationScript({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  refreshMpvExecutable();

  try {
    serverUrl = rawServerUrl ? normalizeServerUrl(rawServerUrl) : null;
    if (!isPlaybackMode(requestedMode)) {
      throw new Error("--mode must be either web or mpv");
    }
    currentMode = requestedMode;
    mpvPresentation = normalizeMpvPresentation(requestedMpvPresentation);
    startMpvFullscreen =
      requestedMpvFullscreen == null
        ? persistedSettings.startMpvFullscreen !== false
        : !["0", "false", "no", "off"].includes(
            requestedMpvFullscreen.toLowerCase(),
          );
  } catch (error: unknown) {
    startupError = asError(error);
  }
}

async function checkJellyfinServer(
  candidate: string,
): Promise<JellyfinServerHealth> {
  return validateJellyfinServer(candidate, {
    fetchImpl: (input, init) => session.defaultSession.fetch(input, init),
  });
}

function assertTrustedSender(event: SenderEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL() || "";
  if (
    !isWithinServer(senderUrl, requiredPath(serverUrl, "Jellyfin server URL"))
  ) {
    throw new Error(
      "The native bridge rejected a request from an untrusted page",
    );
  }
}

function emitMpvEvent(name: MpvEventName, payload: MpvEventPayload = {}): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("jdc:mpv:event", name, payload);
  if (
    (currentMode === "web" || mpvControllerStale) &&
    (["ended", "quit", "failed"] as MpvEventName[]).includes(name)
  ) {
    setTimeout(() => {
      if (mpvController && !mpvController.current) closeMpvController();
    }, 0);
  }
}

function createMpvController(): MpvController {
  if (mpvControllerStale && mpvController && !mpvController.current) {
    closeMpvController();
  }
  if (mpvController) return mpvController;
  mpvController = new MpvController({
    serverUrl: requiredPath(serverUrl, "Jellyfin server URL"),
    executable: mpvExecutable,
    presentation: mpvPresentation,
    integrationScript: mpvIntegrationScript,
    eventSink: emitMpvEvent,
  });
  mpvControllerStale = false;
  return mpvController;
}

function closeMpvController(): void {
  if (!mpvController) return;
  mpvController.close();
  mpvController = null;
  mpvControllerStale = false;
}

function assertSettingsSender(event: SenderEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL() || "";
  const expectedUrl = pathToFileURL(
    requiredPath(settingsPagePath, "Settings page"),
  ).href;
  if (senderUrl !== expectedUrl) {
    throw new Error(
      "The settings bridge rejected a request from an untrusted page",
    );
  }
}

function assertServersSender(event: SenderEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL() || "";
  const expectedUrl = pathToFileURL(
    requiredPath(serversPagePath, "Servers page"),
  ).href;
  if (senderUrl !== expectedUrl) {
    throw new Error(
      "The server manager rejected a request from an untrusted page",
    );
  }
}

function settingsSnapshot(): SettingsSnapshot {
  return {
    playbackMode: currentMode,
    startMpvFullscreen,
    mpvPresentation,
    mpvPath: persistedSettings.mpvPath || "",
    appVersion: app.getVersion(),
  };
}

function serversSnapshot(): ServerManagerSnapshot {
  return {
    servers: persistedSettings.servers,
    canClose: Boolean(mainWindow && !mainWindow.isDestroyed()),
    activeServerId: persistedSettings.activeServerId,
    connectionError: connectionError || undefined,
    statusMessage: serverStatusMessage || undefined,
    appVersion: app.getVersion(),
  };
}

function showSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const pagePath = requiredPath(settingsPagePath, "Settings page");
  const expectedUrl = pathToFileURL(pagePath).href;
  settingsWindow = new BrowserWindow({
    width: 570,
    height: 590,
    minWidth: 460,
    minHeight: 520,
    parent: parent || undefined,
    modal: Boolean(parent),
    show: false,
    title: `${APP_NAME} Settings`,
    webPreferences: {
      preload: requiredPath(settingsPreloadPath, "Settings preload"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== expectedUrl) event.preventDefault();
  });
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  void settingsWindow.loadFile(pagePath);
  return settingsWindow;
}

function emitServersSnapshot(): void {
  if (!serversWindow || serversWindow.isDestroyed()) return;
  serversWindow.webContents.send("jdc:servers:changed", serversSnapshot());
}

function showServersWindow(): BrowserWindow {
  if (serversWindow && !serversWindow.isDestroyed()) {
    serversWindow.show();
    serversWindow.focus();
    emitServersSnapshot();
    return serversWindow;
  }

  const pagePath = requiredPath(serversPagePath, "Servers page");
  const expectedUrl = pathToFileURL(pagePath).href;
  serversWindow = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 540,
    minHeight: 460,
    show: false,
    title: `${APP_NAME} Servers`,
    webPreferences: {
      preload: requiredPath(serversPreloadPath, "Servers preload"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  serversWindow.setMenuBarVisibility(false);
  serversWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== expectedUrl) event.preventDefault();
  });
  serversWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  serversWindow.once("ready-to-show", () => serversWindow?.show());
  serversWindow.on("closed", () => {
    serversWindow = null;
  });
  void serversWindow.loadFile(pagePath);
  return serversWindow;
}

function runSettingsSmoke(): void {
  const window = showSettingsWindow();
  window.webContents.once("did-finish-load", async () => {
    try {
      const report = (await window.webContents.executeJavaScript(`(async () => {
        const settings = await window.settingsApi.load();
        return {
          title: document.title,
          hasForm: Boolean(document.getElementById('settings-form')),
          hasMpvPath: Boolean(document.getElementById('mpv-path')),
          hasBridge: typeof window.settingsApi === 'object',
          playbackMode: settings.playbackMode
        };
      })()`)) as SettingsSmokeReport;
      if (
        !report.hasForm ||
        !report.hasMpvPath ||
        !report.hasBridge ||
        !isPlaybackMode(report.playbackMode)
      ) {
        throw new Error(
          `Incomplete settings surface: ${JSON.stringify(report)}`,
        );
      }
      console.log(
        `${LOG_PREFIX} Settings-window smoke passed:`,
        JSON.stringify(report),
      );
      app.exit(0);
    } catch (error: unknown) {
      console.error(`${LOG_PREFIX} Settings-window smoke failed:`, error);
      app.exit(1);
    }
  });
}

function runServerFailureSmoke(): void {
  const window = showServersWindow();
  window.webContents.once("did-finish-load", async () => {
    try {
      const report = (await window.webContents.executeJavaScript(`(async () => {
        const settings = await window.serverManagerApi.load();
        return {
          hasBridge: typeof window.serverManagerApi === 'object',
          connectionError: settings.connectionError
        };
      })()`)) as ServerFailureSmokeReport;
      if (mainWindow || !report.hasBridge || !report.connectionError) {
        throw new Error(
          `Invalid server did not recover to Settings: ${JSON.stringify(report)}`,
        );
      }
      console.log(
        `${LOG_PREFIX} Invalid-server recovery smoke passed:`,
        report.connectionError,
      );
      app.exit(0);
    } catch (error: unknown) {
      console.error(
        `${LOG_PREFIX} Invalid-server recovery smoke failed:`,
        error,
      );
      app.exit(1);
    }
  });
}

function runServersSmoke(): void {
  const window = showServersWindow();
  window.webContents.once("did-finish-load", async () => {
    try {
      const report = (await window.webContents.executeJavaScript(`(async () => {
        const snapshot = await window.serverManagerApi.load();
        return {
          title: document.title,
          hasForm: Boolean(document.getElementById('server-form')),
          hasServerUrl: Boolean(document.getElementById('server-url')),
          hasBridge: typeof window.serverManagerApi === 'object',
          hasServerList: Array.isArray(snapshot.servers)
        };
      })()`)) as ServersSmokeReport;
      if (
        !report.hasForm ||
        !report.hasServerUrl ||
        !report.hasBridge ||
        !report.hasServerList
      ) {
        throw new Error(
          `Incomplete server manager surface: ${JSON.stringify(report)}`,
        );
      }
      console.log(
        `${LOG_PREFIX} Server-manager smoke passed:`,
        JSON.stringify(report),
      );
      app.exit(0);
    } catch (error: unknown) {
      console.error(`${LOG_PREFIX} Server-manager smoke failed:`, error);
      app.exit(1);
    }
  });
}

function openMainWindow(bounds: Rectangle | null = null): CreatedWindow | null {
  if (!serverUrl) return null;
  const created = createWindow({ bounds });
  mainWindow = created.window;
  installMenu();
  created.ready
    .then(() => {
      connectionError = null;
      installMenu();
    })
    .catch((error: unknown) => {
      recoverFromMainLoadFailure(created.window, error);
    });
  return created;
}

function recoverFromMainLoadFailure(
  failedWindow: BrowserWindow,
  error: unknown,
): void {
  console.error(`${LOG_PREFIX} Initial load failed:`, error);
  closeMpvController();
  connectionError = `Jellyfin Web could not be loaded. ${errorMessage(error)}`;
  serverStatusMessage = null;
  showServersWindow();
  emitServersSnapshot();
  if (mainWindow === failedWindow) mainWindow = null;
  if (!failedWindow.isDestroyed()) failedWindow.destroy();
}

function profileFromHealth(health: JellyfinServerHealth): ServerProfile {
  return {
    id: health.serverId,
    name: health.serverName,
    url: health.serverUrl,
    version: health.version || undefined,
  };
}

function savePersistedSettings(settings: AppSettings): void {
  persistedSettings = saveSettings(
    requiredPath(settingsPath, "Settings path"),
    settings,
  );
}

async function confirmServerSwitch(): Promise<void> {
  if (!mpvController?.current) return;
  const owner =
    serversWindow && !serversWindow.isDestroyed()
      ? serversWindow
      : mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : undefined;
  const options = {
    type: "warning" as const,
    title: "Switch Jellyfin server",
    message: "Stop the current MPV playback and switch servers?",
    detail: "Deskfin will close the current player before opening the server.",
    buttons: ["Stop and switch", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  };
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 0) throw new Error("Server switch canceled");
  await mpvController.execute("stop");
}

function scheduleActiveServerWindow(bounds: Rectangle | null): void {
  setTimeout(() => {
    const oldWindow =
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    closeMpvController();
    const created = openMainWindow(bounds);
    if (!created) {
      connectionError = "The selected Jellyfin server could not be opened.";
      serverStatusMessage = null;
      showServersWindow();
      emitServersSnapshot();
      return;
    }
    if (oldWindow) oldWindow.destroy();
    created.ready
      .then(() => {
        connectionError = null;
        serverStatusMessage = null;
        if (serversWindow && !serversWindow.isDestroyed())
          serversWindow.close();
        installMenu();
      })
      .catch(() => {
        // openMainWindow routes the failure back to the server picker.
      });
  }, 0);
}

async function activateValidatedServer(
  health: JellyfinServerHealth,
  replacingId?: string,
): Promise<ServerManagerSnapshot> {
  const existingActive = activeServer(persistedSettings);
  const sameOpenServer =
    Boolean(mainWindow && !mainWindow.isDestroyed()) &&
    existingActive?.id === health.serverId &&
    serverUrl === health.serverUrl;

  if (!sameOpenServer) await confirmServerSwitch();
  savePersistedSettings(
    upsertServer(persistedSettings, profileFromHealth(health), replacingId),
  );
  serverUrl = health.serverUrl;
  connectionError = null;
  serverStatusMessage = `Connecting to ${health.serverName}...`;
  installMenu();

  if (sameOpenServer) {
    serverStatusMessage = null;
    setTimeout(() => {
      if (serversWindow && !serversWindow.isDestroyed()) serversWindow.close();
      mainWindow?.show();
      mainWindow?.focus();
    }, 0);
  } else {
    const bounds =
      mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    scheduleActiveServerWindow(bounds);
  }
  return serversSnapshot();
}

async function activateSavedServer(
  serverId: string,
): Promise<ServerManagerSnapshot> {
  const profile = persistedSettings.servers.find(
    (server) => server.id === serverId,
  );
  if (!profile)
    throw new Error("The selected Jellyfin server no longer exists");
  serverStatusMessage = `Checking ${profile.name}...`;
  connectionError = null;
  emitServersSnapshot();
  try {
    const health = await checkJellyfinServer(profile.url);
    return activateValidatedServer(health, profile.id);
  } catch (error: unknown) {
    serverStatusMessage = null;
    connectionError = errorMessage(error);
    emitServersSnapshot();
    throw error;
  }
}

function saveServerRequest(value: unknown): SaveServerRequest {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error("A Jellyfin server address is required");
  }
  const request: SaveServerRequest = { url: value.url };
  if (typeof value.replacingId === "string" && value.replacingId) {
    request.replacingId = value.replacingId;
  }
  return request;
}

async function saveServer(value: unknown): Promise<ServerManagerSnapshot> {
  const request = saveServerRequest(value);
  serverStatusMessage = "Checking Jellyfin server...";
  connectionError = null;
  emitServersSnapshot();
  try {
    const health = await checkJellyfinServer(request.url);
    return activateValidatedServer(health, request.replacingId);
  } catch (error: unknown) {
    serverStatusMessage = null;
    connectionError = errorMessage(error);
    emitServersSnapshot();
    throw error;
  }
}

async function removeSavedServer(
  serverId: string,
): Promise<ServerManagerSnapshot> {
  if (!persistedSettings.servers.some((server) => server.id === serverId)) {
    throw new Error("The selected Jellyfin server no longer exists");
  }
  const removedActiveServer = persistedSettings.activeServerId === serverId;
  if (removedActiveServer) await confirmServerSwitch();
  savePersistedSettings(removeServer(persistedSettings, serverId));
  if (removedActiveServer) {
    closeMpvController();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    mainWindow = null;
    serverUrl = null;
    connectionError = null;
    serverStatusMessage = null;
  }
  installMenu();
  return serversSnapshot();
}

async function applySettings(rawSettings: unknown): Promise<SettingsSnapshot> {
  const source = isRecord(rawSettings) ? rawSettings : {};
  const nextSettings = normalizeSettings({
    ...persistedSettings,
    playbackMode: source.playbackMode,
    startMpvFullscreen: source.startMpvFullscreen,
    mpvPresentation: source.mpvPresentation,
    mpvPath: source.mpvPath,
  });
  const previousMpvPath = persistedSettings.mpvPath || "";
  const previousPresentation = mpvPresentation;

  savePersistedSettings(nextSettings);
  startMpvFullscreen = nextSettings.startMpvFullscreen;
  mpvPresentation = normalizeMpvPresentation(nextSettings.mpvPresentation);
  refreshMpvExecutable();

  const mpvConfigurationChanged =
    previousMpvPath !== (nextSettings.mpvPath || "") ||
    previousPresentation !== mpvPresentation;
  if (mpvConfigurationChanged && mpvController) {
    if (mpvController.current) mpvControllerStale = true;
    else closeMpvController();
  }
  await switchMode(nextSettings.playbackMode);
  installMenu();

  setTimeout(() => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  }, 0);
  return settingsSnapshot();
}

function registerIpc(): void {
  ipcMain.handle("jdc:servers:load", (event: IpcMainInvokeEvent) => {
    assertServersSender(event);
    return serversSnapshot();
  });
  ipcMain.handle(
    "jdc:servers:save",
    async (event: IpcMainInvokeEvent, request: unknown) => {
      assertServersSender(event);
      return saveServer(request);
    },
  );
  ipcMain.handle(
    "jdc:servers:activate",
    async (event: IpcMainInvokeEvent, serverId: unknown) => {
      assertServersSender(event);
      if (typeof serverId !== "string") {
        throw new Error("A saved Jellyfin server is required");
      }
      return activateSavedServer(serverId);
    },
  );
  ipcMain.handle(
    "jdc:servers:remove",
    async (event: IpcMainInvokeEvent, serverId: unknown) => {
      assertServersSender(event);
      if (typeof serverId !== "string") {
        throw new Error("A saved Jellyfin server is required");
      }
      return removeSavedServer(serverId);
    },
  );
  ipcMain.handle("jdc:settings:load", (event: IpcMainInvokeEvent) => {
    assertSettingsSender(event);
    return settingsSnapshot();
  });
  ipcMain.handle(
    "jdc:settings:save",
    async (event: IpcMainInvokeEvent, settings: unknown) => {
      assertSettingsSender(event);
      return applySettings(settings);
    },
  );
  ipcMain.handle(
    "jdc:settings:browse-mpv",
    async (event: IpcMainInvokeEvent) => {
      assertSettingsSender(event);
      const options: OpenDialogOptions = {
        title: "Select MPV executable",
        properties: ["openFile"],
      };
      if (process.platform === "win32") {
        options.filters = [
          { name: "Applications", extensions: ["exe"] },
          { name: "All files", extensions: ["*"] },
        ];
      }
      const owner =
        settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null;
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] || null;
    },
  );
  ipcMain.handle("jdc:mpv:status", (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    const status = mpvController?.status() || {
      available: true,
      ready: false,
      executable: mpvExecutable,
      presentation: mpvPresentation,
      reason: "",
    };
    return {
      ...status,
      backend: currentMode,
      startFullscreen: startMpvFullscreen,
    };
  });
  ipcMain.handle(
    "jdc:mpv:load",
    async (event: IpcMainInvokeEvent, request: unknown) => {
      assertTrustedSender(event);
      return createMpvController().load(request);
    },
  );
  const commands = {
    play: "play",
    pause: "pause",
    stop: "stop",
    seek: "seek",
    setVolume: "volume",
    setMuted: "muted",
    setRate: "rate",
    setAudioTrack: "audioTrack",
    setSubtitleTrack: "subtitleTrack",
    setFullscreen: "fullscreen",
  } as const;
  for (const [channelName, commandName] of Object.entries(commands)) {
    ipcMain.handle(
      `jdc:mpv:${channelName}`,
      async (event: IpcMainInvokeEvent, value: unknown) => {
        assertTrustedSender(event);
        return createMpvController().execute(commandName, value);
      },
    );
  }
  ipcMain.handle(
    "jdc:open-external",
    async (event: IpcMainInvokeEvent, rawUrl: unknown) => {
      assertTrustedSender(event);
      if (typeof rawUrl !== "string") throw new Error("URL must be a string");
      if (
        !isWithinServer(rawUrl, requiredPath(serverUrl, "Jellyfin server URL"))
      ) {
        throw new Error(
          "Only pages on the configured Jellyfin server may be opened",
        );
      }
      await shell.openExternal(new URL(rawUrl).href);
      return true;
    },
  );
  ipcMain.handle(
    "jdc:play-here",
    (event: IpcMainInvokeEvent, rawUrl: unknown) => {
      assertTrustedSender(event);
      if (typeof rawUrl !== "string") throw new Error("URL must be a string");
      if (
        !isWithinServer(rawUrl, requiredPath(serverUrl, "Jellyfin server URL"))
      ) {
        throw new Error(
          "The inline playback destination is outside the Jellyfin server",
        );
      }
      setTimeout(() => {
        switchMode("web", new URL(rawUrl).href).catch((error: unknown) => {
          console.error(
            `${LOG_PREFIX} Could not switch to Web playback:`,
            error,
          );
        });
      }, 0);
      return true;
    },
  );
  ipcMain.handle("jdc:focus-app", (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  });
  ipcMain.on("jdc:preload-error", (_event: IpcMainEvent, message: unknown) => {
    console.error(`${LOG_PREFIX} Preload injection failed:`, message);
  });
  ipcMain.on(
    "jdc:injection-status",
    (_event: IpcMainEvent, status: unknown) => {
      console.log(`${LOG_PREFIX} Player injection:`, JSON.stringify(status));
    },
  );
}

function codecProbeSource(): string {
  return `(() => {
    const video = document.createElement('video');
    const audio = document.createElement('audio');
    const mse = type => typeof MediaSource !== 'undefined'
      && typeof MediaSource.isTypeSupported === 'function'
      && MediaSource.isTypeSupported(type);
    return {
      userAgent: navigator.userAgent,
      h264AacMp4: video.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"'),
      h264Mp4: video.canPlayType('video/mp4; codecs="avc1.640028"'),
      aac: audio.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
      hevc: video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.B0"'),
      vp9: video.canPlayType('video/webm; codecs="vp9, opus"'),
      av1: video.canPlayType('video/mp4; codecs="av01.0.05M.08, opus"'),
      mseH264Aac: mse('video/mp4; codecs="avc1.640028, mp4a.40.2"'),
      mseHevc: mse('video/mp4; codecs="hvc1.1.6.L120.B0"')
    };
  })()`;
}

async function collectCodecReport(
  showDialog: boolean = false,
  targetWindow: BrowserWindow | null = mainWindow,
  mode: PlaybackMode = currentMode,
): Promise<Record<string, unknown> | null> {
  if (!targetWindow || targetWindow.isDestroyed()) return null;
  try {
    const report = (await targetWindow.webContents.executeJavaScript(
      codecProbeSource(),
    )) as Record<string, unknown>;
    const complete = {
      mode,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      ...report,
    };
    console.log(
      `${LOG_PREFIX} Codec report:`,
      JSON.stringify(complete, null, 2),
    );
    if (showDialog) {
      await dialog.showMessageBox(targetWindow, {
        type: "info",
        title: "Electron codec report",
        message: "Embedded media capability report",
        detail: JSON.stringify(complete, null, 2),
      });
    }
    return complete;
  } catch (error: unknown) {
    console.warn(`${LOG_PREFIX} Codec probe failed:`, errorMessage(error));
    return null;
  }
}

function switchMode(
  mode: PlaybackMode,
  targetUrl: string | null = null,
): Promise<void> {
  if (switchPromise) return switchPromise;
  if (mode === currentMode && !targetUrl) return Promise.resolve();

  switchPromise = (async () => {
    currentMode = mode;
    if (mode === "mpv" && serverUrl) createMpvController();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`${APP_NAME} - ${mode.toUpperCase()}`);
      mainWindow.webContents.send("jdc:mpv:event", "mode", { value: mode });
    }
    installMenu();
    persistRuntimeSettings();

    if (mode === "web" && mpvController && !mpvController.current) {
      closeMpvController();
    }
    if (targetUrl && mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(targetUrl);
    }
  })().finally(() => {
    switchPromise = null;
  });
  return switchPromise;
}

function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [];
  const serverItems: MenuItemConstructorOptions[] =
    persistedSettings.servers.length > 0
      ? persistedSettings.servers.map((server) => ({
          label: server.name,
          sublabel: server.url,
          type: "radio" as const,
          checked: server.id === persistedSettings.activeServerId,
          click: () => {
            serverStatusMessage = `Checking ${server.name}...`;
            connectionError = null;
            activateSavedServer(server.id).catch((error: unknown) => {
              console.error(
                `${LOG_PREFIX} Could not switch to ${server.name}:`,
                error,
              );
              installMenu();
              showServersWindow();
              emitServersSnapshot();
            });
          },
        }))
      : [{ label: "No saved servers", enabled: false }];
  if (process.platform === "darwin") template.push({ role: "appMenu" });
  template.push(
    {
      label: "Application",
      submenu: [
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => showSettingsWindow(),
        },
      ],
    },
    {
      label: "Servers",
      submenu: [
        ...serverItems,
        { type: "separator" },
        {
          label: "Switch or add server...",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => showServersWindow(),
        },
      ],
    },
    {
      label: "Playback",
      enabled: Boolean(serverUrl),
      submenu: [
        {
          label: "Web player",
          type: "radio",
          checked: currentMode === "web",
          accelerator: "CmdOrCtrl+Shift+W",
          click: () => switchMode("web").catch(console.error),
        },
        {
          label: "MPV player",
          type: "radio",
          checked: currentMode === "mpv",
          accelerator: "CmdOrCtrl+Shift+M",
          click: () => switchMode("mpv").catch(console.error),
        },
        { type: "separator" },
        {
          label: "Start MPV fullscreen",
          type: "checkbox",
          checked: startMpvFullscreen,
          click: (item) => {
            startMpvFullscreen = item.checked;
            persistRuntimeSettings();
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Diagnostics",
      enabled: Boolean(serverUrl),
      submenu: [
        { label: "Show codec report", click: () => collectCodecReport(true) },
      ],
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow({
  mode = currentMode,
  targetUrl,
  showWhenReady = true,
  bounds = null,
}: CreateWindowOptions = {}): CreatedWindow {
  if (!serverUrl)
    throw new Error(
      "A Jellyfin server URL is required before opening the client",
    );
  if (mode === "mpv") createMpvController();
  const destination = targetUrl || `${serverUrl}/web/`;
  const preloadArguments = [
    `--jdc-server-url=${encodeURIComponent(serverUrl)}`,
    `--jdc-mode=${mode}`,
    `--jdc-app-version=${encodeURIComponent(app.getVersion())}`,
  ];
  const window = new BrowserWindow({
    ...(bounds || { width: 1280, height: 800 }),
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: `${APP_NAME} - ${mode.toUpperCase()}`,
    webPreferences: {
      preload: requiredPath(preloadPath, "Main preload"),
      additionalArguments: preloadArguments,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (showWhenReady && !window.isDestroyed()) window.show();
      resolve();
    };
    window.webContents.once("did-finish-load", finish);
    window.webContents.once(
      "did-fail-load",
      (_event, code, description, _url, isMainFrame) => {
        if (!isMainFrame || code === -3 || settled) return;
        settled = true;
        reject(
          new Error(`Jellyfin Web failed to load: ${code} ${description}`),
        );
      },
    );
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    if (!quitting && BrowserWindow.getAllWindows().length === 0) {
      closeMpvController();
    }
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isWithinServer(url, requiredPath(serverUrl, "Jellyfin server URL"))) {
      return;
    }
    event.preventDefault();
    if (["http:", "https:"].includes(new URL(url).protocol)) {
      void shell.openExternal(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (["http:", "https:"].includes(new URL(url).protocol))
        void shell.openExternal(url);
    } catch {
      // Invalid and non-web URLs are ignored.
    }
    return { action: "deny" };
  });
  window.webContents.on(
    "did-fail-load",
    (_event, code, description, url, isMainFrame) => {
      if (isMainFrame)
        console.error(
          `${LOG_PREFIX} Failed to load ${url}: ${code} ${description}`,
        );
    },
  );
  window.webContents.once("did-finish-load", () =>
    collectCodecReport(false, window, mode),
  );
  void window.loadURL(destination);
  return { window, ready };
}

app.on("before-quit", () => {
  quitting = true;
  closeMpvController();
});

app.on("activate", () => {
  if (!isPrimaryInstance) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    if (serverUrl) openMainWindow();
    else showServersWindow();
  }
});

if (isPrimaryInstance) {
  app.on("second-instance", () => focusExistingInstance());
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  initializeRuntime();
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );
  registerIpc();
  installMenu();
  if (smokeSettings) {
    runSettingsSmoke();
    return;
  }
  if (smokeServers) {
    runServersSmoke();
    return;
  }
  if (startupError) {
    connectionError = startupError.message;
    await dialog.showMessageBox({
      type: "error",
      title: APP_NAME,
      message: startupError.message,
      detail:
        "Correct the saved values in Settings, or remove invalid command-line overrides.",
    });
    showServersWindow();
    return;
  }
  if (!serverUrl) {
    showServersWindow();
    return;
  }

  try {
    const previousProfile = activeServer(persistedSettings);
    const candidateServerUrl = serverUrl;
    const health = await checkJellyfinServer(candidateServerUrl);
    serverUrl = health.serverUrl;
    connectionError = null;
    serverStatusMessage = null;
    const replacingId =
      previousProfile &&
      normalizeServerUrl(previousProfile.url) ===
        normalizeServerUrl(candidateServerUrl)
        ? previousProfile.id
        : undefined;
    savePersistedSettings(
      upsertServer(persistedSettings, profileFromHealth(health), replacingId),
    );
    installMenu();
  } catch (error: unknown) {
    connectionError = errorMessage(error);
    serverUrl = null;
    console.error(`${LOG_PREFIX} Server validation failed:`, error);
    installMenu();
    if (smokeServerFailure) runServerFailureSmoke();
    else showServersWindow();
    return;
  }

  const initial = openMainWindow();
  if (!initial) throw new Error("Could not create the main window");
  if (smokeSwitch) {
    const initialWindow = initial.window;
    initial.ready
      .then(() => switchMode(currentMode === "web" ? "mpv" : "web"))
      .then(() => {
        if (mainWindow !== initialWindow || initialWindow.isDestroyed()) {
          throw new Error(
            "Playback mode switch replaced the application window",
          );
        }
        console.log(
          `${LOG_PREFIX} In-place mode-switch smoke passed in ${currentMode} mode`,
        );
        app.quit();
      })
      .catch((error: unknown) => {
        console.error(`${LOG_PREFIX} Mode-switch smoke failed:`, error);
        process.exitCode = 1;
        app.quit();
      });
  } else {
    initial.ready.catch(() => {});
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
