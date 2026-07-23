import { redactSensitive } from "./logging";

export interface DeskfinDiagnostics {
  generatedAt: string;
  application: {
    name: string;
    version: string;
    packaged: boolean;
  };
  platform: {
    operatingSystem: string;
    release: string;
    architecture: string;
  };
  runtime: {
    electron: string;
    chromium: string;
    node: string;
  };
  playback: {
    mode: string;
    mpvPresentation: string;
    startMpvFullscreen: boolean;
  };
  mpv: {
    available: boolean;
    version: string | null;
    source: string;
    executableName: string;
    reason: string;
  };
  jellyfin: {
    savedServerCount: number;
    activeServerVersion: string | null;
    connected: boolean;
  };
  codecs?: Record<string, unknown>;
}

export function createDiagnosticsReport(value: DeskfinDiagnostics): string {
  return redactSensitive(
    [
      "Deskfin diagnostics",
      "No access tokens, server addresses, media URLs, or account details are included.",
      "",
      JSON.stringify(value, null, 2),
    ].join("\n"),
  );
}
