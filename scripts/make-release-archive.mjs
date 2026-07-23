import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageDeskfin } from "./package-app.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

export function platformReleaseName(platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  throw new Error(`Unsupported release platform: ${platform}`);
}

export function releaseArchiveName({ productName, version, platform, arch }) {
  const extension = platform === "linux" ? "tar.gz" : "zip";
  return `${productName}-${version}-${platformReleaseName(platform)}-${arch}.${extension}`;
}

export function releaseTagVersion(tag) {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export function assertReleaseTagVersion(version, tag) {
  if (!tag) return;
  if (releaseTagVersion(tag) !== version) {
    throw new Error(
      `Release tag ${tag} does not match package.json version ${version}`,
    );
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(`${command} exited with ${code ?? signal ?? "unknown"}`),
        );
      }
    });
  });
}

async function archiveDirectory(sourcePath, archivePath) {
  if (process.platform === "win32") {
    await run("tar", [
      "-a",
      "-cf",
      archivePath,
      "-C",
      path.dirname(sourcePath),
      path.basename(sourcePath),
    ]);
    return;
  }
  if (process.platform === "darwin") {
    await run("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      sourcePath,
      archivePath,
    ]);
    return;
  }
  if (process.platform === "linux") {
    await run("tar", [
      "-czf",
      archivePath,
      "-C",
      path.dirname(sourcePath),
      path.basename(sourcePath),
    ]);
    return;
  }
  throw new Error(`Unsupported release platform: ${process.platform}`);
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function makeReleaseArchive() {
  const packageJson = JSON.parse(
    await fsp.readFile(path.join(projectRoot, "package.json"), "utf8"),
  );
  const productName = packageJson.productName;
  const version = packageJson.version;
  if (typeof productName !== "string" || !productName) {
    throw new Error("package.json is missing productName");
  }
  if (typeof version !== "string" || !version) {
    throw new Error("package.json is missing version");
  }
  assertReleaseTagVersion(version, process.env.DESKFIN_RELEASE_TAG || "");

  const [bundlePath] = await packageDeskfin();
  if (!bundlePath) throw new Error("Electron Packager returned no application");
  const releaseDirectory = path.join(projectRoot, "out", "release");
  const archiveName = releaseArchiveName({
    productName,
    version,
    platform: process.platform,
    arch: process.arch,
  });
  const archivePath = path.join(releaseDirectory, archiveName);
  const checksumPath = `${archivePath}.sha256`;

  await fsp.mkdir(releaseDirectory, { recursive: true });
  await fsp.rm(archivePath, { force: true });
  await fsp.rm(checksumPath, { force: true });
  await archiveDirectory(bundlePath, archivePath);

  const archive = await fsp.stat(archivePath);
  if (!archive.isFile() || archive.size === 0) {
    throw new Error(`Release archive was not created: ${archivePath}`);
  }
  const checksum = await sha256(archivePath);
  await fsp.writeFile(checksumPath, `${checksum}  ${archiveName}\n`, "utf8");

  console.log(`Created release archive: ${archivePath}`);
  console.log(`Created SHA-256 checksum: ${checksumPath}`);
  return { archivePath, checksumPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await makeReleaseArchive();
}
