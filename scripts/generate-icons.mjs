import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const iconDirectory = path.join(projectRoot, "resources", "icons");
const sourcePath = path.join(iconDirectory, "deskfin.svg");
const checkOnly = process.argv.includes("--check");

const source = fs.readFileSync(sourcePath);
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
const pngs = new Map();

for (const size of sizes) {
  pngs.set(
    size,
    await sharp(source, { density: 384 })
      .resize(size, size, { fit: "fill" })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer(),
  );
}

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

function createIcns(images) {
  const typeBySize = new Map([
    [16, "icp4"],
    [32, "icp5"],
    [64, "icp6"],
    [128, "ic07"],
    [256, "ic08"],
    [512, "ic09"],
    [1024, "ic10"],
  ]);
  const chunks = images.map(({ size, data }) => {
    const type = typeBySize.get(size);
    if (!type) throw new Error(`No ICNS type is defined for ${size}px`);
    const chunk = Buffer.alloc(8 + data.length);
    chunk.write(type, 0, 4, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    data.copy(chunk, 8);
    return chunk;
  });
  const length = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(length, 4);
  return Buffer.concat([header, ...chunks]);
}

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];
const output = new Map([
  [path.join(iconDirectory, "deskfin.png"), pngs.get(512)],
  [
    path.join(iconDirectory, "deskfin.ico"),
    createIco(icoSizes.map((size) => ({ size, data: pngs.get(size) }))),
  ],
  [
    path.join(iconDirectory, "deskfin.icns"),
    createIcns(icnsSizes.map((size) => ({ size, data: pngs.get(size) }))),
  ],
]);

for (const [filePath, expected] of output) {
  if (!expected)
    throw new Error(`Could not generate ${path.basename(filePath)}`);
  if (checkOnly) {
    if (
      !fs.existsSync(filePath) ||
      !fs.readFileSync(filePath).equals(expected)
    ) {
      throw new Error(
        `${path.relative(projectRoot, filePath)} is missing or stale; run npm run assets:icons`,
      );
    }
  } else {
    fs.writeFileSync(filePath, expected);
    console.log(
      `Generated ${path.relative(projectRoot, filePath)} (${expected.length} bytes)`,
    );
  }
}

if (checkOnly) console.log("Deskfin icon assets are current");
