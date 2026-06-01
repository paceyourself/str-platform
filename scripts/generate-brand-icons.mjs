/**
 * Generates VeroSTR favicon and apple-touch-icon.
 * Run: node scripts/generate-brand-icons.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#0f172a"/>
  <text x="90" y="128" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="108" fill="#ffffff" text-anchor="middle">V</text>
</svg>
`;

async function main() {
  const svgBuffer = Buffer.from(svg);

  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, "apple-touch-icon.png"));

  await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toFile(path.join(publicDir, "favicon-32.png"));

  await sharp(svgBuffer)
    .resize(32, 32)
    .toFormat("png")
    .toFile(path.join(publicDir, "favicon.ico"));

  console.log("Wrote public/apple-touch-icon.png and public/favicon.ico");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
