import sharp from "sharp";
import { RuleError, requireRule } from "../../shared/rules.js";

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_IMAGE_INPUT = 3 * 1024 * 1024;
sharp.cache(false);
sharp.concurrency(1);
let busy = false;
const waiting = [];
export async function normalizeProductImage(bytes, contentType) {
  requireRule(
    Buffer.isBuffer(bytes) && bytes.length > 0,
    "An image file is required",
  );
  if (bytes.length > MAX_IMAGE_INPUT)
    throw new RuleError("Images must be at most 3 MB", 413);
  const format = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "jpeg"
      : bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP"
        ? "webp"
        : null;
  requireRule(
    format && contentType === `image/${format}`,
    "Upload a valid JPG, PNG or WebP image with matching content type",
  );
  if (busy) {
    if (waiting.length >= 4)
      throw new RuleError("Image processing busy; try again shortly", 503);
    await new Promise((resolve) => waiting.push(resolve));
  } else busy = true;
  try {
    const pipeline = sharp(bytes, {
      limitInputPixels: 12000000,
      failOn: "warning",
      sequentialRead: true,
    });
    const metadata = await pipeline.metadata();
    requireRule(
      metadata.format === format && (!metadata.pages || metadata.pages === 1),
      "Animated and unsupported images are not accepted",
    );
    const { data, info } = await pipeline
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78, effort: 3 })
      .toBuffer({ resolveWithObject: true });
    requireRule(
      data.length <= 1024 * 1024,
      "Optimized image is too large; upload a smaller image",
    );
    const thumbnail = await sharp(data)
      .resize({
        width: 320,
        height: 320,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 65, effort: 2 })
      .toBuffer();
    return {
      data,
      thumbnail,
      width: info.width,
      height: info.height,
      size: data.length,
    };
  } catch (error) {
    if (error instanceof RuleError) throw error;
    throw new RuleError(
      "Image cannot be decoded or exceeds the 12 megapixel limit",
      422,
    );
  } finally {
    const next = waiting.shift();
    if (next) next();
    else busy = false;
  }
}
