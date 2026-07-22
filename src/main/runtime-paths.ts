import * as path from "node:path";

interface MpvIntegrationPathOptions {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

export function resolvePreloadPath(appPath: string): string {
  return path.join(appPath, "dist", "preload.js");
}

export function resolveSettingsPagePath(appPath: string): string {
  return path.join(appPath, "src", "renderer", "settings", "index.html");
}

export function resolveSettingsPreloadPath(appPath: string): string {
  return path.join(appPath, "dist", "settings-preload.js");
}

export function resolveServersPagePath(appPath: string): string {
  return path.join(appPath, "src", "renderer", "servers", "index.html");
}

export function resolveServersPreloadPath(appPath: string): string {
  return path.join(appPath, "dist", "servers-preload.js");
}

export function resolveMpvIntegrationScript({
  appPath,
  isPackaged,
  resourcesPath,
}: MpvIntegrationPathOptions): string {
  const base = isPackaged ? resourcesPath : path.join(appPath, "resources");
  return path.join(base, "mpv", "jellyfin_dc.lua");
}
