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
  const productName = packageJson.productName;
  const product = packageJson.deskfin;
  if (
    typeof productName !== "string" ||
    !productName ||
    typeof product?.appId !== "string" ||
    typeof product?.executableName !== "string" ||
    typeof product?.category !== "string"
  ) {
    throw new Error("package.json is missing the Deskfin product identity");
  }
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
  if (Object.keys(packageJson.optionalDependencies || {}).length > 0) {
    throw new Error(
      "Optional dependencies require an explicit packaged node_modules policy",
    );
  }
  const iconDirectory = path.join(projectRoot, "resources", "icons");
  const iconPath =
    process.platform === "win32"
      ? path.join(iconDirectory, "deskfin.ico")
      : process.platform === "darwin"
        ? path.join(iconDirectory, "deskfin.icns")
        : undefined;

  return packager({
    dir: projectRoot,
    name: productName,
    executableName: product.executableName,
    appBundleId: product.appId,
    helperBundleId: `${product.appId}.helper`,
    appCategoryType: product.category,
    appCopyright: `Copyright (c) ${new Date().getUTCFullYear()} Deskfin contributors`,
    icon: iconPath,
    win32metadata: {
      CompanyName: "Deskfin contributors",
      FileDescription: packageJson.description,
      InternalName: product.executableName,
      OriginalFilename: `${product.executableName}.exe`,
      ProductName: productName,
    },
    out: path.join(projectRoot, "out"),
    overwrite: true,
    asar: true,
    prune: true,
    electronVersion,
    platform: process.platform,
    arch: process.arch,
    extraResource: [
      path.join(projectRoot, "resources", "icons"),
      path.join(projectRoot, "resources", "mpv"),
      path.join(projectRoot, "LICENSE"),
    ],
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
