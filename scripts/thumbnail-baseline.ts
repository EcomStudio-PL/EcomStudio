/**
 * AN INDEPENDENT, HAND-WRITTEN MINIATURKA REQUEST — the reference the app's
 * serialiser is compared against byte for byte (npm run test:thumbnail).
 *
 * Imports NOTHING from the application. Written from the OpenAI Images API
 * `images.edits` multipart shape (RFC 7578; the official SDK sends an image
 * array as repeated `image[]` parts in order): the seven text fields, then one
 * file part per photo. If the app's serialiser ever drifts — a reordered
 * field, a rewritten line ending, a dropped duplicate — this comparison fails.
 */

export type BaselinePhoto = { filename: string; mime: string; bytes: Buffer };

export function baselineThumbnailBody(input: {
  boundary: string; model: string; prompt: string; size: string; quality: string; photos: BaselinePhoto[];
}): Buffer {
  const b = input.boundary;
  const text = (name: string, value: string) => Buffer.concat([
    Buffer.from("--" + b + "\r\n" + 'Content-Disposition: form-data; name="' + name + '"' + "\r\n\r\n", "latin1"),
    Buffer.from(value, "utf8"),
    Buffer.from("\r\n", "latin1"),
  ]);
  const parts: Buffer[] = [
    text("model", input.model),
    text("prompt", input.prompt),
    text("n", "1"),
    text("size", input.size),
    text("quality", input.quality),
    text("background", "opaque"),
    text("output_format", "png"),
  ];
  for (const p of input.photos) {
    parts.push(Buffer.from(
      "--" + b + "\r\n"
      + 'Content-Disposition: form-data; name="image[]"; filename="' + p.filename + '"' + "\r\n"
      + "Content-Type: " + p.mime + "\r\n\r\n",
      "latin1",
    ));
    parts.push(p.bytes);
    parts.push(Buffer.from("\r\n", "latin1"));
  }
  parts.push(Buffer.from("--" + b + "--\r\n", "latin1"));
  return Buffer.concat(parts);
}
