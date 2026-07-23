import { spawn } from "node:child_process";
import { COMPATIBILITY, supportsMpvVersion } from "../../shared/compatibility";
import type { MpvDiagnostic, MpvExecutableSource } from "../../shared/types";

const MPV_VERSION_TIMEOUT_MS = 3000;
const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface InspectMpvOptions {
  configuredPathIgnored?: boolean;
  run?: (executable: string) => Promise<ProcessResult>;
}

function hasMpvExecutableName(executable: string): boolean {
  const name = executable.split(/[\\/]/).pop() || "";
  return /^mpv(?:\.exe|\.com)?$/i.test(name);
}

export function parseMpvVersionOutput(
  output: string,
): { version: string; versionLine: string } | null {
  const versionLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!versionLine || !/^mpv\b/i.test(versionLine)) return null;
  const match = versionLine.match(
    /^mpv\s+v?([0-9]+(?:\.[0-9]+)+(?:[-+._a-z0-9]*)?)/i,
  );
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
  }: InspectMpvOptions = {},
): Promise<MpvDiagnostic> {
  const base = {
    executable,
    source,
    supported: false,
    configuredPathIgnored,
  };
  if (!hasMpvExecutableName(executable)) {
    return {
      ...base,
      available: false,
      version: null,
      versionLine: null,
      reason: "Select the MPV executable (mpv, mpv.exe, or mpv.com)",
    };
  }
  try {
    const result = await run(executable);
    const parsed = parseMpvVersionOutput(result.stdout || result.stderr);
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
    return {
      ...base,
      available: true,
      supported: supportsMpvVersion(parsed.version),
      ...parsed,
      reason: supportsMpvVersion(parsed.version)
        ? ""
        : `Deskfin supports MPV ${COMPATIBILITY.minimumMpvVersion} or newer`,
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
