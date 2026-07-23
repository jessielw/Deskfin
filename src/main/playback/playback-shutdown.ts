export type PlaybackShutdownReason = "quit" | "window-close" | "server-switch";

export interface PlaybackShutdownRequest {
  requestId: string;
  reason: PlaybackShutdownReason;
}

interface PendingShutdown {
  requestId: string;
  senderId: number;
  promise: Promise<boolean>;
  resolve(value: boolean): void;
  timer: ReturnType<typeof setTimeout>;
}

export class PlaybackShutdownCoordinator {
  private readonly timeoutMs: number;
  private sequence = 0;
  private pending: PendingShutdown | null = null;

  constructor(timeoutMs = 3000) {
    this.timeoutMs = timeoutMs;
  }

  request(
    senderId: number,
    reason: PlaybackShutdownReason,
    send: (request: PlaybackShutdownRequest) => void,
  ): Promise<boolean> {
    if (this.pending) return this.pending.promise;

    const requestId = `${process.pid}:${++this.sequence}`;
    let resolveRequest: (value: boolean) => void = () => {};
    const promise = new Promise<boolean>((resolve) => {
      resolveRequest = resolve;
    });
    const timer = setTimeout(() => this.finish(false), this.timeoutMs);
    this.pending = {
      requestId,
      senderId,
      promise,
      resolve: resolveRequest,
      timer,
    };

    try {
      send({ requestId, reason });
    } catch {
      this.finish(false);
    }
    return promise;
  }

  acknowledge(senderId: number, requestId: string): boolean {
    if (
      !this.pending ||
      this.pending.senderId !== senderId ||
      this.pending.requestId !== requestId
    ) {
      return false;
    }
    this.finish(true);
    return true;
  }

  cancel(): void {
    this.finish(false);
  }

  private finish(result: boolean): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(result);
  }
}
