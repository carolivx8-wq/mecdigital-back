import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "profile-photos";

export interface ProfilePhotoStore {
  upload(recordId: string, bytes: Buffer): Promise<string>;
  remove(path: string): Promise<void>;
  createSignedUrl(path: string): Promise<string>;
}

export class SupabaseProfilePhotoStore implements ProfilePhotoStore {
  constructor(private readonly client: SupabaseClient) {}

  async upload(recordId: string, bytes: Buffer): Promise<string> {
    const path = `${recordId}/${randomUUID()}.webp`;
    const { error } = await this.client.storage.from(BUCKET).upload(path, bytes, {
      contentType: "image/webp",
      cacheControl: "3600",
      upsert: false
    });
    if (error) throw error;
    return path;
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(BUCKET).remove([path]);
    if (error) throw error;
  }

  async createSignedUrl(path: string): Promise<string> {
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error) throw error;
    return data.signedUrl;
  }
}

export function isWebP(bytes: Buffer): boolean {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

export async function normalizeProfilePhoto(bytes: Buffer): Promise<Buffer> {
  if (!isWebP(bytes)) throw new Error("INVALID_PROFILE_PHOTO");
  const image = sharp(bytes, { animated: false, failOn: "warning", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.pages && metadata.pages > 1) throw new Error("INVALID_PROFILE_PHOTO");
  const normalized = await image
    .rotate()
    .resize(1024, 1024, { fit: "cover", position: "centre", withoutEnlargement: true })
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
  if (normalized.length > 1_000_000) throw new Error("PROFILE_PHOTO_TOO_LARGE");
  return normalized;
}
