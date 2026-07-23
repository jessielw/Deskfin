import * as fs from "node:fs";
import * as path from "node:path";
import type { MpvExecutableSource } from "../../shared/types";

export interface ResolveMpvExecutableOptions {
  commandLinePath?: string | null;
  environmentPath?: string;
  configuredPath?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pathIsFile?: (candidate: string) => boolean;
  commonPaths?: string[];
}

export interface MpvExecutableResolution {
  executable: string;
  source: MpvExecutableSource;
  ignoredConfiguredPath: string | null;
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    if (process.platform !== "win32") {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  const key = Object.keys(environment).find(
    (candidate) => candidate.toLowerCase() === wanted,
  );
  return key ? environment[key] : undefined;
}

function pathApi(platform: NodeJS.Platform): typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

export function commonMpvPaths(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const paths: string[] = [];
  const candidatePath = pathApi(platform);
  const append = (base: string | undefined, ...parts: string[]) => {
    if (base) paths.push(candidatePath.join(base, ...parts));
  };

  if (platform === "win32") {
    append(
      environmentValue(environment, "LOCALAPPDATA"),
      "Programs",
      "mpv",
      "mpv.exe",
    );
    append(environmentValue(environment, "PROGRAMFILES"), "mpv", "mpv.exe");
    append(
      environmentValue(environment, "PROGRAMFILES(X86)"),
      "mpv",
      "mpv.exe",
    );
    append(
      environmentValue(environment, "USERPROFILE"),
      "scoop",
      "apps",
      "mpv",
      "current",
      "mpv.exe",
    );
    append(
      environmentValue(environment, "CHOCOLATEYINSTALL"),
      "bin",
      "mpv.exe",
    );
  } else if (platform === "darwin") {
    paths.push(
      "/Applications/mpv.app/Contents/MacOS/mpv",
      "/opt/homebrew/bin/mpv",
      "/usr/local/bin/mpv",
      "/usr/bin/mpv",
    );
  } else {
    paths.push(
      "/usr/bin/mpv",
      "/usr/local/bin/mpv",
      "/snap/bin/mpv",
      "/app/bin/mpv",
    );
  }
  return [...new Set(paths)];
}

function executableNames(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): string[] {
  if (platform !== "win32") return ["mpv"];
  const extensions = (
    environmentValue(environment, "PATHEXT") || ".EXE;.CMD;.BAT"
  )
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([".exe", ...extensions])].map(
    (extension) => `mpv${extension}`,
  );
}

function findMpvOnPath(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  pathIsFile: (candidate: string) => boolean,
): string | null {
  const rawPath = environmentValue(environment, "PATH");
  if (!rawPath) return null;
  const candidatePath = pathApi(platform);
  const delimiter = platform === "win32" ? ";" : ":";
  const directories = rawPath
    .split(delimiter)
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  for (const directory of directories) {
    for (const name of executableNames(platform, environment)) {
      const candidate = candidatePath.join(directory, name);
      if (pathIsFile(candidate)) return candidate;
    }
  }
  return null;
}

export function resolveMpvExecutable({
  commandLinePath,
  environmentPath,
  configuredPath,
  environment = process.env,
  platform = process.platform,
  pathIsFile = isExecutableFile,
  commonPaths = commonMpvPaths(platform, environment),
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

  const pathExecutable = findMpvOnPath(platform, environment, pathIsFile);
  if (pathExecutable) {
    return {
      executable: pathExecutable,
      source: "path",
      ignoredConfiguredPath: configuredPath || null,
    };
  }

  const commonExecutable = commonPaths.find((candidate) =>
    pathIsFile(candidate),
  );
  if (commonExecutable) {
    return {
      executable: commonExecutable,
      source: "common",
      ignoredConfiguredPath: configuredPath || null,
    };
  }

  return {
    executable: "mpv",
    source: "unresolved",
    ignoredConfiguredPath: configuredPath || null,
  };
}
