import type { ServerProfile } from "../shared/types";

const LOGIN_STORAGE_TYPES = [
  "cookies",
  "filesystem",
  "indexdb",
  "localstorage",
  "serviceworkers",
  "cachestorage",
] as const;

interface StorageDataSession {
  clearStorageData(options: {
    origin: string;
    storages: [...typeof LOGIN_STORAGE_TYPES];
  }): Promise<void>;
}

export function serverOrigin(serverUrl: string): string {
  return new URL(serverUrl).origin;
}

export function profilesSharingOrigin(
  profiles: ServerProfile[],
  profile: ServerProfile,
): ServerProfile[] {
  const origin = serverOrigin(profile.url);
  return profiles.filter((candidate) => serverOrigin(candidate.url) === origin);
}

export async function clearServerLoginData(
  targetSession: StorageDataSession,
  serverUrl: string,
): Promise<void> {
  await targetSession.clearStorageData({
    origin: serverOrigin(serverUrl),
    storages: [...LOGIN_STORAGE_TYPES],
  });
}
