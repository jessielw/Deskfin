import { spawn } from "node:child_process";
import { COMPATIBILITY, supportsMpvVersion } from "../../shared/compatibility";
import type {
  MpvDiagnostic,
  MpvExecutableSource,
  MpvProvider,
} from "../../shared/types";
import { detectMpvProvider, isMpvProvider } from "./mpv-provider";
import { isChocolateyMpvNetShim } from "./mpv-resolution";

const MPV_VERSION_TIMEOUT_MS = 3000;
const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface InspectMpvOptions {
  configuredPathIgnored?: boolean;
  platform?: NodeJS.Platform;
  run?: (executable: string) => Promise<ProcessResult>;
}

export function parseMpvVersionOutput(
  output: string,
  provider: MpvProvider = "unknown",
): { version: string; versionLine: string } | null {
  const prefix =
    provider === "mpv.net"
      ? "mpv(?:\\.net|net)"
      : provider === "mpv"
        ? "mpv"
        : "mpv(?:\\.net|net)?";
  const versionPattern = new RegExp(
    `^${prefix}\\s+v?([0-9]+(?:\\.[0-9]+)+(?:[-+._a-z0-9]*)?)`,
    "i",
  );
  const versionLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => versionPattern.test(line));
  if (!versionLine) return null;
  const match = versionLine.match(versionPattern);
  if (!match?.[1]) return null;
  return { version: match[1], versionLine: versionLine.slice(0, 512) };
}

function runVersionProbe(executable: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ProcessResult | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString()}`.slice(0, MAX_VERSION_OUTPUT_BYTES);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish({ code, stdout, stderr }));
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("MPV version check timed out"));
    }, MPV_VERSION_TIMEOUT_MS);
  });
}

export async function inspectMpvExecutable(
  executable: string,
  source: MpvExecutableSource,
  {
    configuredPathIgnored = false,
    run = runVersionProbe,
    platform = process.platform,
  }: InspectMpvOptions = {},
): Promise<MpvDiagnostic> {
  const provider = detectMpvProvider(executable);
  const base = {
    executable,
    provider,
    source,
    supported: false,
    configuredPathIgnored,
  };
  if (!isMpvProvider(provider)) {
    return {
      ...base,
      available: false,
      version: null,
      versionLine: null,
      reason:
        "Select the MPV executable (mpv, mpv.exe, mpv.com, or mpvnet.exe)",
    };
  }
  if (isChocolateyMpvNetShim(executable)) {
    return {
      ...base,
      available: false,
      version: null,
      versionLine: null,
      reason:
        "This is Chocolatey's mpv.net launcher shim; select the real mpvnet.exe from the package tools directory",
    };
  }
  if (provider === "mpv.net" && platform !== "win32") {
    return {
      ...base,
      available: false,
      version: null,
      versionLine: null,
      reason: "mpv.net is only supported on Windows",
    };
  }
  try {
    const result = await run(executable);
    const parsed = parseMpvVersionOutput(
      `${result.stdout}\n${result.stderr}`,
      provider,
    );
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().split(/\r?\n/)[0];
      return {
        ...base,
        available: false,
        version: null,
        versionLine: null,
        reason: detail
          ? `MPV exited with code ${result.code}: ${detail}`
          : `MPV exited with code ${result.code}`,
      };
    }
    if (!parsed) {
      return {
        ...base,
        available: false,
        version: null,
        versionLine: null,
        reason:
          "The selected executable did not return a recognizable MPV version",
      };
    }
    const versionSupported =
      provider === "mpv.net" || supportsMpvVersion(parsed.version);
    return {
      ...base,
      available: true,
      supported: versionSupported,
      ...parsed,
      reason: versionSupported
        ? ""
        : `Noktus supports MPV ${COMPATIBILITY.minimumMpvVersion} or newer`,
    };
  } catch (error: unknown) {
    return {
      ...base,
      available: false,
      version: null,
      versionLine: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
