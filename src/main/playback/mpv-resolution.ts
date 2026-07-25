import * as fs from "node:fs";
import * as path from "node:path";
import type { MpvExecutableSource, MpvProvider } from "../../shared/types";
import { detectMpvProvider } from "./mpv-provider";

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
  provider: MpvProvider;
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
    append(
      environmentValue(environment, "LOCALAPPDATA"),
      "Programs",
      "mpv.net",
      "mpvnet.exe",
    );
    append(
      environmentValue(environment, "CHOCOLATEYINSTALL"),
      "lib",
      "mpvnet.portable",
      "tools",
      "mpvnet.exe",
    );
    append(
      environmentValue(environment, "CHOCOLATEYINSTALL"),
      "lib",
      "mpv.net",
      "tools",
      "mpvnet.exe",
    );
    append(
      environmentValue(environment, "PROGRAMFILES"),
      "mpv.net",
      "mpvnet.exe",
    );
    append(
      environmentValue(environment, "PROGRAMFILES(X86)"),
      "mpv.net",
      "mpvnet.exe",
    );
    append(
      environmentValue(environment, "USERPROFILE"),
      "scoop",
      "apps",
      "mpv.net",
      "current",
      "mpvnet.exe",
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
  const extensions = (environmentValue(environment, "PATHEXT") || ".EXE;.COM")
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value === ".exe" || value === ".com");
  const allExtensions = [...new Set([".exe", ".com", ...extensions])];
  return [
    ...allExtensions.map((extension) => `mpv${extension}`),
    ...allExtensions.map((extension) => `mpvnet${extension}`),
  ];
}

export function isChocolateyMpvNetShim(candidate: string): boolean {
  return /[\\/]chocolatey[\\/]bin[\\/]mpvnet(?:\.exe|\.com)?$/i.test(candidate);
}

export interface ResolveMpvExecutableAliasOptions {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pathIsFile?: (candidate: string) => boolean;
  commonPaths?: string[];
}

export function resolveMpvExecutableAlias(
  executable: string,
  {
    environment = process.env,
    platform = process.platform,
    pathIsFile = isExecutableFile,
    commonPaths = commonMpvPaths(platform, environment),
  }: ResolveMpvExecutableAliasOptions = {},
): string {
  if (platform !== "win32" || !isChocolateyMpvNetShim(executable)) {
    return executable;
  }
  return (
    commonPaths.find(
      (candidate) =>
        !isChocolateyMpvNetShim(candidate) &&
        detectMpvProvider(candidate) === "mpv.net" &&
        pathIsFile(candidate),
    ) || executable
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
  const names = executableNames(platform, environment);
  let fallbackShim: string | null = null;
  for (const name of names) {
    for (const directory of directories) {
      const candidate = candidatePath.join(directory, name);
      if (name.startsWith("mpvnet") && isChocolateyMpvNetShim(candidate)) {
        if (pathIsFile(candidate) && !fallbackShim) fallbackShim = candidate;
        continue;
      }
      if (pathIsFile(candidate)) return candidate;
    }
  }
  return fallbackShim;
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
    const executable = resolveMpvExecutableAlias(commandLinePath, {
      environment,
      platform,
      pathIsFile,
      commonPaths,
    });
    return {
      executable,
      provider: detectMpvProvider(executable),
      source: "command-line",
      ignoredConfiguredPath: null,
    };
  }
  if (environmentPath) {
    const executable = resolveMpvExecutableAlias(environmentPath, {
      environment,
      platform,
      pathIsFile,
      commonPaths,
    });
    return {
      executable,
      provider: detectMpvProvider(executable),
      source: "environment",
      ignoredConfiguredPath: null,
    };
  }
  if (configuredPath && pathIsFile(configuredPath)) {
    const executable = resolveMpvExecutableAlias(configuredPath, {
      environment,
      platform,
      pathIsFile,
      commonPaths,
    });
    return {
      executable,
      provider: detectMpvProvider(executable),
      source: "settings",
      ignoredConfiguredPath: null,
    };
  }

  const pathExecutable = findMpvOnPath(platform, environment, pathIsFile);
  if (pathExecutable && !isChocolateyMpvNetShim(pathExecutable)) {
    return {
      executable: pathExecutable,
      provider: detectMpvProvider(pathExecutable),
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
      provider: detectMpvProvider(commonExecutable),
      source: "common",
      ignoredConfiguredPath: configuredPath || null,
    };
  }

  if (pathExecutable) {
    return {
      executable: pathExecutable,
      provider: detectMpvProvider(pathExecutable),
      source: "path",
      ignoredConfiguredPath: configuredPath || null,
    };
  }

  return {
    executable: "mpv",
    provider: "mpv",
    source: "unresolved",
    ignoredConfiguredPath: configuredPath || null,
  };
}
