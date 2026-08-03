export function normalizeMpvProfile(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("MPV profile must be a string");
  }
  const profile = value.trim();
  if (!profile) return undefined;
  if (profile.length > 128) {
    throw new Error("MPV profile must be 128 characters or fewer");
  }
  if (/[,\u0000-\u001f\u007f]/u.test(profile)) {
    throw new Error("MPV profile contains unsupported characters");
  }
  return profile;
}
