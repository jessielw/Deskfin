import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageNoktus } from "./package-app.mjs";

const SMOKE_TIMEOUT_MS = 45_000;
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const executableName = packageJson.noktus.executableName;
const productName = packageJson.productName;

function executablePath(bundlePath) {
  if (process.platform === "win32") {
    return path.join(bundlePath, `${executableName}.exe`);
  }
  if (process.platform === "darwin") {
    return path.join(
      bundlePath,
      `${productName}.app`,
      "Contents",
      "MacOS",
      executableName,
    );
  }
  return path.join(bundlePath, executableName);
}

function launchSmoke(executable, userDataPath) {
  const smokeArguments = [
    ...(process.platform === "linux" &&
    process.env.NOKTUS_TEST_NO_SANDBOX === "1"
      ? ["--no-sandbox"]
      : []),
    "--smoke-packaged",
    `--smoke-user-data=${encodeURIComponent(userDataPath)}`,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, smokeArguments, {
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `Packaged Noktus smoke exited with ${code ?? signal ?? "unknown"}`,
          ),
        );
      }
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Packaged Noktus smoke timed out"));
    }, SMOKE_TIMEOUT_MS);
  });
}

const [bundlePath] = await packageNoktus();
if (!bundlePath) throw new Error("Electron Packager returned no application");
const executable = executablePath(bundlePath);
if (!fs.existsSync(executable)) {
  throw new Error(`Packaged executable was not created: ${executable}`);
}
const userDataPath = path.join(
  path.dirname(bundlePath),
  `smoke-user-data-${process.platform}-${process.arch}`,
);
await launchSmoke(executable, userDataPath);
