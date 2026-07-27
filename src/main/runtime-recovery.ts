export type MainRecoveryReason =
  "load-failure" | "renderer-crash" | "unresponsive" | "resume";

export type RendererFailureKind = "crashed" | "unresponsive";

export type RendererRecoveryAction =
  "reload" | "switch-server" | "wait" | "quit";

export interface RendererRecoveryPrompt {
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

export function shouldRecoverMainFrameLoadFailure(
  errorCode: number,
  isMainFrame: boolean,
  quitting: boolean,
): boolean {
  return isMainFrame && errorCode !== -3 && !quitting;
}

export function mainRecoveryMessage(
  reason: MainRecoveryReason,
  detail?: string,
): string {
  const summary =
    reason === "resume"
      ? "Noktus could not reconnect to Jellyfin after the computer resumed."
      : reason === "renderer-crash"
        ? "The Jellyfin Web process stopped unexpectedly."
        : reason === "unresponsive"
          ? "Jellyfin Web stopped responding."
          : "Jellyfin Web could not load the active server.";
  return detail ? `${summary} ${detail}` : summary;
}

export function rendererRecoveryPrompt(
  kind: RendererFailureKind,
  detail: string,
): RendererRecoveryPrompt {
  if (kind === "unresponsive") {
    return {
      title: "Jellyfin Web is not responding",
      message: "The Jellyfin interface has stopped responding.",
      detail,
      buttons: ["Wait", "Reload Noktus", "Switch server"],
      defaultId: 0,
      cancelId: 0,
    };
  }
  return {
    title: "Jellyfin Web stopped",
    message: "The Jellyfin interface stopped unexpectedly.",
    detail,
    buttons: ["Reload Noktus", "Switch server", "Quit"],
    defaultId: 0,
    cancelId: 2,
  };
}

export function rendererRecoveryAction(
  kind: RendererFailureKind,
  response: number,
): RendererRecoveryAction {
  if (kind === "unresponsive") {
    if (response === 1) return "reload";
    if (response === 2) return "switch-server";
    return "wait";
  }
  if (response === 0) return "reload";
  if (response === 1) return "switch-server";
  return "quit";
}
