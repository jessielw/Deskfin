import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageDeskfin } from "./package-app.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const PACKAGE_NAME = "deskfin";
const ARCHITECTURE = "amd64";

export function debArtifactName(productName, version) {
  return `${productName}_${version}_${ARCHITECTURE}.deb`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      shell: false,
      stdio: "inherit",
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

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function controlFile(version, description) {
  const synopsis = description.replaceAll(/\s+/g, " ").trim();
  return [
    `Package: ${PACKAGE_NAME}`,
    `Version: ${version}`,
    `Architecture: ${ARCHITECTURE}`,
    "Maintainer: Deskfin contributors <deskfin@localhost>",
    "Section: video",
    "Priority: optional",
    "Depends: libasound2 | libasound2t64, libatk-bridge2.0-0, libatk1.0-0, libc6, libcairo2, libcups2, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0, libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libx11-6, libx11-xcb1, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, libxrender1, libxshmfence1, libxss1, libxtst6, xdg-utils",
    `Description: ${synopsis}`,
    " Deskfin is a thin Jellyfin desktop client with Web and MPV playback.",
    "",
  ].join("\n");
}

function desktopFile(productName, description) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${productName}`,
    `Comment=${description}`,
    "Exec=deskfin %U",
    "Icon=deskfin",
    "Terminal=false",
    "Categories=AudioVideo;Video;Network;",
    "StartupWMClass=Deskfin",
    "",
  ].join("\n");
}

function launcherFile(executableName) {
  return `#!/bin/sh\nexec /opt/Deskfin/${executableName} "$@"\n`;
}

async function writeFile(filePath, contents, mode = undefined) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, contents, "utf8");
  if (mode !== undefined) await fsp.chmod(filePath, mode);
}

export async function makeDeb() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Debian packages can only be built on Linux x64 runners");
  }

  const packageJson = JSON.parse(
    await fsp.readFile(path.join(projectRoot, "package.json"), "utf8"),
  );
  const { productName, version, description } = packageJson;
  const executableName = packageJson.deskfin?.executableName;
  if (
    typeof productName !== "string" ||
    !productName ||
    typeof version !== "string" ||
    !version ||
    typeof description !== "string" ||
    !description ||
    typeof executableName !== "string" ||
    !executableName
  ) {
    throw new Error("package.json is missing Debian package metadata");
  }

  const [bundlePath] = await packageDeskfin();
  if (!bundlePath) throw new Error("Electron Packager returned no application");

  const outputDirectory = path.join(projectRoot, "out", "release");
  const stagingDirectory = path.join(projectRoot, "out", "deb-staging");
  const archiveName = debArtifactName(productName, version);
  const archivePath = path.join(outputDirectory, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const applicationDirectory = path.join(stagingDirectory, "opt", productName);
  const sandboxPath = path.join(applicationDirectory, "chrome-sandbox");

  await fsp.rm(stagingDirectory, { recursive: true, force: true });
  await fsp.mkdir(outputDirectory, { recursive: true });
  await fsp.rm(archivePath, { force: true });
  await fsp.rm(checksumPath, { force: true });
  await fsp.cp(bundlePath, applicationDirectory, { recursive: true });
  await fsp.chmod(sandboxPath, 0o4755);
  await writeFile(
    path.join(stagingDirectory, "DEBIAN", "control"),
    controlFile(version, description),
  );
  await writeFile(
    path.join(stagingDirectory, "usr", "bin", PACKAGE_NAME),
    launcherFile(executableName),
    0o755,
  );
  await writeFile(
    path.join(
      stagingDirectory,
      "usr",
      "share",
      "applications",
      `${PACKAGE_NAME}.desktop`,
    ),
    desktopFile(productName, description),
  );
  await fsp.mkdir(
    path.join(
      stagingDirectory,
      "usr",
      "share",
      "icons",
      "hicolor",
      "512x512",
      "apps",
    ),
    { recursive: true },
  );
  await fsp.copyFile(
    path.join(projectRoot, "resources", "icons", "deskfin.png"),
    path.join(
      stagingDirectory,
      "usr",
      "share",
      "icons",
      "hicolor",
      "512x512",
      "apps",
      `${PACKAGE_NAME}.png`,
    ),
  );

  await run("dpkg-deb", [
    "--root-owner-group",
    "--build",
    stagingDirectory,
    archivePath,
  ]);
  const archive = await fsp.stat(archivePath);
  if (!archive.isFile() || archive.size === 0) {
    throw new Error(`Debian package was not created: ${archivePath}`);
  }
  const checksum = await sha256(archivePath);
  await fsp.writeFile(checksumPath, `${checksum}  ${archiveName}\n`, "utf8");

  console.log(`Created Debian package: ${archivePath}`);
  console.log(`Created SHA-256 checksum: ${checksumPath}`);
  return { archivePath, checksumPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await makeDeb();
}
