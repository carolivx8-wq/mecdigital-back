import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function requireSecret(secret: string) {
  if (secret.length < 32) throw new Error("PUBLIC_LINK_SECRET must have at least 32 characters");
}

function encryptionKey(secret: string): Buffer {
  requireSecret(secret);
  return createHash("sha256").update(`mecdigital-public-link-encryption-v1:${secret}`).digest();
}

export function generatePublicLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPublicLinkToken(token: string, secret: string): string {
  requireSecret(secret);
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function isValidPublicLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function encryptPublicLinkToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptPublicLinkToken(payload: string, secret: string): string {
  const [version, iv, tag, encrypted] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted public link token");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
