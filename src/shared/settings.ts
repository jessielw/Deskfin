import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeServerUrl } from "./url-policy";
import type {
  AppSettings,
  MpvPresentation,
  PlaybackMode,
  ServerProfile,
} from "./types";

export const SETTINGS_VERSION = 1;

interface SettingsLogger {
  warn(...values: unknown[]): void;
}

interface LoadSettingsOptions {
  logger?: SettingsLogger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function defaultServerName(serverUrl: string): string {
  const candidate = new URL(serverUrl);
  return candidate.port
    ? `${candidate.hostname}:${candidate.port}`
    : candidate.hostname;
}

function legacyServerId(serverUrl: string): string {
  return `legacy:${serverUrl}`;
}

function normalizeServerProfile(value: unknown): ServerProfile | null {
  if (!isRecord(value) || typeof value.url !== "string") return null;
  try {
    const url = normalizeServerUrl(value.url);
    const rawId = typeof value.id === "string" ? value.id.trim() : "";
    const rawName = typeof value.name === "string" ? value.name.trim() : "";
    const profile: ServerProfile = {
      id: rawId || legacyServerId(url),
      name: rawName || defaultServerName(url),
      url,
    };
    if (typeof value.version === "string" && value.version.trim()) {
      profile.version = value.version.trim();
    }
    return profile;
  } catch {
    return null;
  }
}

function normalizedServers(source: Record<string, unknown>): ServerProfile[] {
  const candidates = Array.isArray(source.servers) ? source.servers : [];
  const byId = new Map<string, ServerProfile>();
  for (const candidate of candidates) {
    const server = normalizeServerProfile(candidate);
    if (server) byId.set(server.id, server);
  }

  if (byId.size === 0 && typeof source.serverUrl === "string") {
    const migrated = normalizeServerProfile({ url: source.serverUrl });
    if (migrated) byId.set(migrated.id, migrated);
  }
  return [...byId.values()];
}

export function normalizeSettings(raw: unknown = {}): AppSettings {
  const source = isRecord(raw) ? raw : {};
  const playbackMode: PlaybackMode =
    source.playbackMode === "mpv" ? "mpv" : "web";
  const mpvPresentation: MpvPresentation =
    source.mpvPresentation === "user" ? "user" : "jellyfin";
  const servers = normalizedServers(source);
  const requestedActiveId =
    typeof source.activeServerId === "string"
      ? source.activeServerId.trim()
      : "";
  const activeServerId = servers.some(
    (server) => server.id === requestedActiveId,
  )
    ? requestedActiveId
    : servers[0]?.id;
  const normalized: AppSettings = {
    version: SETTINGS_VERSION,
    playbackMode,
    startMpvFullscreen: source.startMpvFullscreen !== false,
    mpvPresentation,
    servers,
  };

  if (activeServerId) normalized.activeServerId = activeServerId;
  if (typeof source.mpvPath === "string" && source.mpvPath.trim()) {
    normalized.mpvPath = source.mpvPath.trim();
  }
  return normalized;
}

export function activeServer(settings: AppSettings): ServerProfile | null {
  if (!settings.activeServerId) return null;
  return (
    settings.servers.find((server) => server.id === settings.activeServerId) ||
    null
  );
}

export function upsertServer(
  settings: AppSettings,
  profile: ServerProfile,
  replacingId?: string,
): AppSettings {
  const normalizedProfile = normalizeServerProfile(profile);
  if (!normalizedProfile)
    throw new Error("A valid Jellyfin server is required");
  const insertionIndex = settings.servers.findIndex(
    (server) =>
      server.id === replacingId ||
      server.id === normalizedProfile.id ||
      server.url === normalizedProfile.url,
  );
  const servers = settings.servers.filter(
    (server) =>
      server.id !== replacingId &&
      server.id !== normalizedProfile.id &&
      server.url !== normalizedProfile.url,
  );
  servers.splice(
    insertionIndex < 0
      ? servers.length
      : Math.min(insertionIndex, servers.length),
    0,
    normalizedProfile,
  );
  return normalizeSettings({
    ...settings,
    servers,
    activeServerId: normalizedProfile.id,
  });
}

export function removeServer(
  settings: AppSettings,
  serverId: string,
): AppSettings {
  const servers = settings.servers.filter((server) => server.id !== serverId);
  const activeServerId =
    settings.activeServerId === serverId
      ? servers[0]?.id
      : settings.activeServerId;
  return normalizeSettings({ ...settings, servers, activeServerId });
}

export function loadSettings(
  filePath: string,
  { logger = console }: LoadSettingsOptions = {},
): AppSettings {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error: unknown) {
    if (errorCode(error) !== "ENOENT") {
      logger.warn(
        `[Deskfin] Could not read settings ${filePath}:`,
        errorMessage(error),
      );
    }
    return normalizeSettings();
  }
}

export function saveSettings(filePath: string, settings: unknown): AppSettings {
  const normalized = normalizeSettings(settings);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return normalized;
}
