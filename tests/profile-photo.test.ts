import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeProfilePhoto, type ProfilePhotoStore } from "../src/profile-photo.js";

describe("profile photo normalization", () => {
  it("re-encodes a valid WebP as a square image without metadata", async () => {
    const input = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: "#336699" }
    }).withMetadata({ orientation: 6 }).webp({ quality: 100 }).toBuffer();
    const output = await normalizeProfilePhoto(input);
    const metadata = await sharp(output).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1024);
    expect(metadata.orientation).toBeUndefined();
    expect(output.length).toBeLessThanOrEqual(1_000_000);
  });

  it("rejects a fake WebP payload", async () => {
    const fake = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from("not-an-image")]);
    await expect(normalizeProfilePhoto(fake)).rejects.toThrow();
  });
});
