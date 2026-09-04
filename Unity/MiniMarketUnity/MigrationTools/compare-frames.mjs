// Side-by-side parity check between the authoritative Next capture and the
// Unity build. The third panel maps Next into red and Unity into green, so a
// framing mismatch shows up as colour fringing instead of needing eyeballing.
import { resolve } from 'node:path';
import sharp from 'sharp';

const [referencePath, candidatePath, outputPath] = [
  process.env.MINIMARKET_REFERENCE || '/tmp/mini-market-next-reference.png',
  process.env.MINIMARKET_CANDIDATE || '/tmp/mini-market-unity-gameplay-current.png',
  process.env.MINIMARKET_COMPARISON || '/tmp/mini-market-parity-comparison.png',
];

const load = async (path) => {
  const image = sharp(resolve(path));
  const { width, height } = await image.metadata();
  return { path, width, height, image };
};
const reference = await load(referencePath);
const candidate = await load(candidatePath);
const width = Math.min(reference.width, candidate.width);
const height = Math.min(reference.height, candidate.height);
const raw = async ({ image }) => image.clone().resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
const [left, right] = await Promise.all([raw(reference), raw(candidate)]);

const overlay = Buffer.alloc(width * height * 3);
let sum = 0;
// Luminance keeps the comparison about layout and value rather than the hue
// differences the art swap deliberately introduces.
for (let pixel = 0; pixel < width * height; pixel += 1) {
  const at = pixel * 3;
  const a = left[at] * 0.2126 + left[at + 1] * 0.7152 + left[at + 2] * 0.0722;
  const b = right[at] * 0.2126 + right[at + 1] * 0.7152 + right[at + 2] * 0.0722;
  overlay[at] = a;
  overlay[at + 1] = b;
  overlay[at + 2] = Math.min(a, b) * 0.35;
  sum += Math.abs(a - b);
}
const panel = async (buffer) => sharp(buffer, { raw: { width, height, channels: 3 } }).png().toBuffer();
const [referencePanel, candidatePanel, overlayPanel] = await Promise.all([panel(left), panel(right), panel(overlay)]);

const gap = 12;
await sharp({ create: { width: width * 3 + gap * 2, height, channels: 3, background: { r: 24, g: 26, b: 28 } } })
  .composite([
    { input: referencePanel, left: 0, top: 0 },
    { input: candidatePanel, left: width + gap, top: 0 },
    { input: overlayPanel, left: (width + gap) * 2, top: 0 },
  ])
  .png().toFile(resolve(outputPath));

console.log(JSON.stringify({
  reference: `${reference.path} ${reference.width}x${reference.height}`,
  candidate: `${candidate.path} ${candidate.width}x${candidate.height}`,
  comparison: outputPath,
  meanLuminanceDelta: Number((sum / (width * height)).toFixed(2)),
}, null, 2));
