import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { createSupabaseAdminAuthorizer } from "./auth.js";
import { SupabaseBrandStore } from "./branding.js";
import { SupabaseRecordRepository } from "./repository.js";
import { SupabaseProfilePhotoStore } from "./profile-photo.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function publicWebUrl(): string {
  const value = required("PUBLIC_WEB_URL");
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (!local && url.protocol !== "https:") throw new Error("PUBLIC_WEB_URL must use HTTPS outside local development");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("PUBLIC_WEB_URL must be an absolute origin without credentials, query or fragment");
  }
  return url.origin;
}

export function createConfiguredApp() {
  const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return createApp({
    repository: new SupabaseRecordRepository(supabase),
    profilePhotoStore: new SupabaseProfilePhotoStore(supabase),
    brandStore: new SupabaseBrandStore(supabase),
    authorizeAdmin: createSupabaseAdminAuthorizer(supabase),
    protocolPepper: required("PROTOCOL_PEPPER"),
    publicLinkSecret: required("PUBLIC_LINK_SECRET"),
    publicWebUrl: publicWebUrl(),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)
  });
}
