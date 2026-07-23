import { packager } from "@electron/packager";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

export async function packageDeskfin() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
  const electronVersion = packageJson.devDependencies?.electron;
  if (
    typeof electronVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(electronVersion)
  ) {
    throw new Error("package.json must pin an exact Electron version");
  }
  if (Object.keys(packageJson.dependencies || {}).length > 0) {
    throw new Error(
      "Runtime dependencies require an explicit packaged node_modules policy",
    );
  }

  return packager({
    dir: projectRoot,
    name: "Deskfin",
    out: path.join(projectRoot, "out"),
    overwrite: true,
    asar: true,
    prune: true,
    electronVersion,
    platform: process.platform,
    arch: process.arch,
    extraResource: path.join(projectRoot, "resources", "mpv"),
    ignore: [
      /[\\/]\.agents(?:[\\/]|$)/,
      /[\\/]\.github(?:[\\/]|$)/,
      /[\\/]\.vscode(?:[\\/]|$)/,
      /[\\/]node_modules(?:[\\/]|$)/,
      /[\\/]docs(?:[\\/]|$)/,
      /[\\/]scripts(?:[\\/]|$)/,
      /[\\/]test(?:[\\/]|$)/,
      /[\\/]resources(?:[\\/]|$)/,
      /[\\/]src[\\/](?:main|preload|shared)(?:[\\/]|$)/,
      /[\\/]build[\\/]preload(?:[\\/]|$)/,
      /\.map$/,
      /[\\/](?:README\.md|package-lock\.json|tsconfig\.json|\.gitignore|\.prettierignore|\.prettierrc)$/,
    ],
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const paths = await packageDeskfin();
  for (const outputPath of paths) console.log(outputPath);
}
