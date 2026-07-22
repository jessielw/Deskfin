export function normalizeServerUrl(rawValue: unknown): string {
  let value = String(rawValue || "").trim();
  if (!value) throw new Error("A Jellyfin server URL is required");
  if (!value.includes("://")) value = `http://${value}`;

  const candidate = new URL(value);
  if (!["http:", "https:"].includes(candidate.protocol)) {
    throw new Error("The Jellyfin server URL must use HTTP or HTTPS");
  }
  if (candidate.username || candidate.password) {
    throw new Error("Do not include credentials in the Jellyfin server URL");
  }
  if (candidate.search || candidate.hash) {
    throw new Error(
      "The Jellyfin server URL cannot contain a query or fragment",
    );
  }

  candidate.pathname = candidate.pathname
    .replace(/\/web(?:\/index\.html)?\/?$/i, "")
    .replace(/\/$/, "");
  return candidate.href.replace(/\/$/, "");
}

export function serverBasePath(serverUrl: string): string {
  return new URL(normalizeServerUrl(serverUrl)).pathname.replace(/\/$/, "");
}

export function isWithinServer(rawUrl: string, serverUrl: string): boolean {
  try {
    const candidate = new URL(rawUrl);
    const server = new URL(normalizeServerUrl(serverUrl));
    if (candidate.origin !== server.origin) return false;
    const basePath = server.pathname.replace(/\/$/, "");
    return (
      !basePath ||
      candidate.pathname === basePath ||
      candidate.pathname.startsWith(`${basePath}/`)
    );
  } catch {
    return false;
  }
}

export function validateMediaUrl(rawUrl: unknown, serverUrl: string): string {
  if (typeof rawUrl !== "string" || !rawUrl) {
    throw new Error("A media URL is required");
  }
  if (!isWithinServer(rawUrl, serverUrl)) {
    throw new Error("The media URL is outside the configured Jellyfin server");
  }
  const candidate = new URL(rawUrl);
  if (!["http:", "https:"].includes(candidate.protocol)) {
    throw new Error("The media URL must use HTTP or HTTPS");
  }
  return candidate.href;
}
