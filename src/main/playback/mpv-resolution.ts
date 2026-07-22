import * as fs from "node:fs";

export type MpvExecutableSource =
  "command-line" | "environment" | "settings" | "path";

export interface ResolveMpvExecutableOptions {
  commandLinePath?: string | null;
  environmentPath?: string;
  configuredPath?: string;
  pathIsFile?: (candidate: string) => boolean;
}

export interface MpvExecutableResolution {
  executable: string;
  source: MpvExecutableSource;
  ignoredConfiguredPath: string | null;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function resolveMpvExecutable({
  commandLinePath,
  environmentPath,
  configuredPath,
  pathIsFile = isFile,
}: ResolveMpvExecutableOptions = {}): MpvExecutableResolution {
  if (commandLinePath) {
    return {
      executable: commandLinePath,
      source: "command-line",
      ignoredConfiguredPath: null,
    };
  }
  if (environmentPath) {
    return {
      executable: environmentPath,
      source: "environment",
      ignoredConfiguredPath: null,
    };
  }
  if (configuredPath && pathIsFile(configuredPath)) {
    return {
      executable: configuredPath,
      source: "settings",
      ignoredConfiguredPath: null,
    };
  }
  return {
    executable: "mpv",
    source: "path",
    ignoredConfiguredPath: configuredPath || null,
  };
}
