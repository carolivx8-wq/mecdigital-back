import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import type { AuthorizeAdmin } from "./auth.js";
import type { BrandStore } from "./branding.js";
import { decryptProtocol, encryptProtocol, generateProtocol, hashProtocol, toPublicRecord } from "./domain/protocol.js";
import { decryptPublicLinkToken, encryptPublicLinkToken, generatePublicLinkToken, hashPublicLinkToken } from "./domain/public-link.js";
import type { RecordRepository } from "./repository.js";
import { isWebP, normalizeProfilePhoto, type ProfilePhotoStore } from "./profile-photo.js";
import { brandingLinkSchema, downloadAttemptSchema, listQuerySchema, protocolSchema, publicLinkTokenSchema, recordIdSchema, recordInputSchema, recordPatchSchema } from "./schemas.js";

interface AppDependencies {
  repository: RecordRepository;
  profilePhotoStore?: ProfilePhotoStore;
  brandStore?: BrandStore;
  authorizeAdmin: AuthorizeAdmin;
  protocolPepper: string;
  publicLinkSecret: string;
  publicWebUrl?: string;
  allowedOrigins?: string[];
  protocolGenerator?: () => string;
  log?: (entry: Record<string, unknown>) => void;
}

function errorBody(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicLinkUrl(token: string, publicWebUrl: string) {
  return `${publicWebUrl.replace(/\/$/, "")}/registro/compartilhado#${token}`;
}

function toAdminRecord<T extends { protocol_hash: string; protocol_ciphertext: string | null; public_link_token_hash: string | null; public_link_token_ciphertext: string | null; profile_photo_path: string | null; created_by: string }>(record: T, deps: Pick<AppDependencies, "protocolPepper" | "publicLinkSecret" | "publicWebUrl">, profilePhotoUrl: string | null = null) {
  const { protocol_hash: _protocolHash, protocol_ciphertext: protocolCiphertext, public_link_token_hash: _publicLinkTokenHash, public_link_token_ciphertext: publicLinkTokenCiphertext, profile_photo_path: _profilePhotoPath, created_by: _createdBy, ...safeRecord } = record;
  return {
    ...safeRecord,
    protocol: protocolCiphertext ? decryptProtocol(protocolCiphertext, deps.protocolPepper) : null,
    publicLinkAvailable: Boolean(publicLinkTokenCiphertext),
    profilePhotoUrl
  };
}

export function createApp(deps: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: deps.allowedOrigins?.length ? deps.allowedOrigins : false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    const incomingRequestId = req.header("x-request-id")?.trim();
    const requestId = incomingRequestId && uuidPattern.test(incomingRequestId) ? incomingRequestId : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    const started = Date.now();
    res.on("finish", () => (deps.log ?? console.info)({
      level: "info",
      event: "http_request",
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started
    }));
    next();
  });

  const publicLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    const userId = await deps.authorizeAdmin(req.header("authorization"));
    if (!userId) return res.status(req.header("authorization") ? 403 : 401).json(errorBody("ADMIN_REQUIRED", "Acesso administrativo necessário.", res.locals.requestId));
    res.locals.adminUserId = userId;
    res.setHeader("cache-control", "private, no-store");
    next();
  };
  const signedProfilePhoto = async (record: { profile_photo_path: string | null }) =>
    record.profile_photo_path && deps.profilePhotoStore ? deps.profilePhotoStore.createSignedUrl(record.profile_photo_path) : null;

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));

  app.get("/api/v1/branding", async (_req, res, next) => {
    try {
      const branding = deps.brandStore ? await deps.brandStore.getBranding() : { logoUrl: null, logoLink: null };
      res.setHeader("cache-control", "no-store");
      return res.json({ data: branding });
    } catch (error) { next(error); }
  });

  app.use("/api/v1/protocols", (_req, res, next) => {
    res.setHeader("cache-control", "private, no-store");
    next();
  });
  app.use("/api/v1/public-links", (_req, res, next) => {
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");
    next();
  });

  app.put(
    "/api/v1/admin/branding/logo",
    requireAdmin,
    express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "2mb" }),
    async (req, res, next) => {
      try {
        if (!deps.brandStore) return res.status(503).json(errorBody("BRANDING_UNAVAILABLE", "Personalizacao indisponivel.", res.locals.requestId));
        const contentType = req.header("content-type")?.split(";")[0].trim() ?? "";
        if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
          return res.status(415).json(errorBody("UNSUPPORTED_IMAGE", "Use uma imagem PNG, JPG ou WebP.", res.locals.requestId));
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res.status(400).json(errorBody("EMPTY_IMAGE", "Selecione uma imagem valida.", res.locals.requestId));
        }
        const logoUrl = await deps.brandStore.uploadLogo(req.body, contentType);
        return res.json({ data: { logoUrl } });
      } catch (error) { next(error); }
    }
  );

  app.delete("/api/v1/admin/branding/logo", requireAdmin, async (_req, res, next) => {
    try {
      if (!deps.brandStore) return res.status(503).json(errorBody("BRANDING_UNAVAILABLE", "Personalizacao indisponivel.", res.locals.requestId));
      await deps.brandStore.deleteLogo();
      return res.status(204).send();
    } catch (error) { next(error); }
  });

  app.put("/api/v1/admin/branding/link", requireAdmin, async (req, res, next) => {
    try {
      if (!deps.brandStore) return res.status(503).json(errorBody("BRANDING_UNAVAILABLE", "Personalizacao indisponivel.", res.locals.requestId));
      const { logoLink } = brandingLinkSchema.parse(req.body);
      await deps.brandStore.updateLogoLink(logoLink);
      return res.json({ data: { logoLink } });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/protocols/lookup", publicLimiter, async (req, res, next) => {
    try {
      const { protocol } = protocolSchema.parse(req.body);
      const record = await deps.repository.findActiveByProtocolHash(hashProtocol(protocol, deps.protocolPepper));
      if (!record) {
        const blockedRecord = await deps.repository.findByProtocolHash(hashProtocol(protocol, deps.protocolPepper));
        if (blockedRecord?.status === "archived") return res.status(423).json(errorBody("PROTOCOL_BLOCKED", "Protocolo bloqueado temporariamente! Consulte sua instituição!", res.locals.requestId));
        return res.status(404).json(errorBody("PROTOCOL_NOT_FOUND", "Protocolo não encontrado.", res.locals.requestId));
      }
      return res.json({ data: toPublicRecord(record, await signedProfilePhoto(record)) });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/protocols/download-attempt", publicLimiter, async (req, res, next) => {
    try {
      const { protocol } = downloadAttemptSchema.parse(req.body);
      const record = await deps.repository.findActiveByProtocolHash(hashProtocol(protocol, deps.protocolPepper));
      if (!record) return res.status(404).json(errorBody("PROTOCOL_NOT_FOUND", "Protocolo não encontrado.", res.locals.requestId));
      return res.status(423).json(errorBody("PROTOCOL_BLOCKED", "Protocolo bloqueado temporariamente! Consulte sua instituição!", res.locals.requestId));
    } catch (error) { next(error); }
  });

  app.post("/api/v1/public-links/resolve", publicLimiter, async (req, res, next) => {
    try {
      const parsed = publicLinkTokenSchema.safeParse(req.body);
      if (!parsed.success) return res.status(404).json(errorBody("PUBLIC_LINK_NOT_FOUND", "Link público inválido ou revogado.", res.locals.requestId));
      const { token } = parsed.data;
      const record = await deps.repository.findByPublicLinkTokenHash(hashPublicLinkToken(token, deps.publicLinkSecret));
      if (!record) return res.status(404).json(errorBody("PUBLIC_LINK_NOT_FOUND", "Link público inválido ou revogado.", res.locals.requestId));
      if (record.status === "archived") return res.status(423).json(errorBody("PROTOCOL_BLOCKED", "Registro bloqueado temporariamente! Consulte sua instituição!", res.locals.requestId));
      return res.json({ data: toPublicRecord(record, await signedProfilePhoto(record)) });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/admin/records", requireAdmin, async (req, res, next) => {
    try {
      const input = recordInputSchema.parse(req.body);
      const protocol = (deps.protocolGenerator ?? generateProtocol)();
      const record = await deps.repository.create(input, hashProtocol(protocol, deps.protocolPepper), encryptProtocol(protocol, deps.protocolPepper), res.locals.adminUserId);
      return res.status(201).json({ data: { record: toAdminRecord(record, deps, await signedProfilePhoto(record)), protocol } });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/admin/records", requireAdmin, async (req, res, next) => {
    try {
      const query = listQuerySchema.parse(req.query);
      const result = await deps.repository.list(query.page, query.pageSize, query.search);
      return res.json({ data: await Promise.all(result.items.map(async (record) => toAdminRecord(record, deps, await signedProfilePhoto(record)))), meta: { page: query.page, pageSize: query.pageSize, total: result.total } });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/admin/records/:id", requireAdmin, async (req, res, next) => {
    try {
      const record = await deps.repository.findById(recordIdSchema.parse(String(req.params.id)));
      if (!record) return res.status(404).json(errorBody("RECORD_NOT_FOUND", "Registro não encontrado.", res.locals.requestId));
      return res.json({ data: toAdminRecord(record, deps, await signedProfilePhoto(record)) });
    } catch (error) { next(error); }
  });

  app.patch("/api/v1/admin/records/:id", requireAdmin, async (req, res, next) => {
    try {
      const input = recordPatchSchema.parse(req.body);
      const record = await deps.repository.update(recordIdSchema.parse(String(req.params.id)), input);
      if (!record) return res.status(404).json(errorBody("RECORD_NOT_FOUND", "Registro não encontrado.", res.locals.requestId));
      return res.json({ data: toAdminRecord(record, deps, await signedProfilePhoto(record)) });
    } catch (error) { next(error); }
  });

  app.put(
    "/api/v1/admin/records/:id/profile-photo",
    requireAdmin,
    express.raw({ type: "image/webp", limit: "1mb" }),
    async (req, res, next) => {
      try {
        if (!deps.profilePhotoStore) return res.status(503).json(errorBody("PHOTO_STORAGE_UNAVAILABLE", "Armazenamento de foto indisponível.", res.locals.requestId));
        const id = recordIdSchema.parse(String(req.params.id));
        const current = await deps.repository.findById(id);
        if (!current) return res.status(404).json(errorBody("RECORD_NOT_FOUND", "Registro não encontrado.", res.locals.requestId));
        if (!Buffer.isBuffer(req.body) || !isWebP(req.body)) return res.status(415).json(errorBody("INVALID_PROFILE_PHOTO", "Envie uma imagem WebP válida.", res.locals.requestId));
        const oldPath = current.profile_photo_path;
        const normalized = await normalizeProfilePhoto(req.body);
        const newPath = await deps.profilePhotoStore.upload(id, normalized);
        let persisted = false;
        try {
          const updated = await deps.repository.setProfilePhotoPath(id, newPath);
          if (!updated) throw new Error("Record disappeared during profile photo update");
          persisted = true;
        } catch (error) {
          await deps.profilePhotoStore.remove(newPath).catch(() => undefined);
          throw error;
        }
        if (oldPath) {
          await deps.profilePhotoStore.remove(oldPath).catch((error: unknown) => {
            (deps.log ?? console.error)({
              level: "error",
              event: "profile_photo_cleanup_failed",
              requestId: res.locals.requestId,
              errorType: error instanceof Error ? error.name : "unknown"
            });
          });
        }
        if (!persisted) throw new Error("Profile photo was not persisted");
        return res.json({ data: { profilePhotoUrl: await deps.profilePhotoStore.createSignedUrl(newPath) } });
      } catch (error) { next(error); }
    }
  );

  app.delete("/api/v1/admin/records/:id/profile-photo", requireAdmin, async (req, res, next) => {
    try {
      if (!deps.profilePhotoStore) return res.status(503).json(errorBody("PHOTO_STORAGE_UNAVAILABLE", "Armazenamento de foto indisponível.", res.locals.requestId));
      const id = recordIdSchema.parse(String(req.params.id));
      const current = await deps.repository.findById(id);
      if (!current) return res.status(404).json(errorBody("RECORD_NOT_FOUND", "Registro não encontrado.", res.locals.requestId));
      const oldPath = current.profile_photo_path;
      await deps.repository.setProfilePhotoPath(id, null);
      if (oldPath) {
        await deps.profilePhotoStore.remove(oldPath).catch((error: unknown) => {
          (deps.log ?? console.error)({
            level: "error",
            event: "profile_photo_cleanup_failed",
            requestId: res.locals.requestId,
            errorType: error instanceof Error ? error.name : "unknown"
          });
        });
      }
      return res.status(204).send();
    } catch (error) { next(error); }
  });

  async function writePublicLink(recordId: string, rotate: boolean, res: Response) {
    const current = await deps.repository.findById(recordId);
    if (!current) return res.status(404).json(errorBody("RECORD_NOT_FOUND", "Registro não encontrado.", res.locals.requestId));
    if (!rotate && current.public_link_token_ciphertext) {
      const token = decryptPublicLinkToken(current.public_link_token_ciphertext, deps.publicLinkSecret);
      return res.json({ data: { url: publicLinkUrl(token, deps.publicWebUrl ?? "http://localhost:3000"), createdAt: current.public_link_created_at } });
    }
    const expectedHash = current.public_link_token_hash;
    const token = generatePublicLinkToken();
    const createdAt = new Date().toISOString();
    const updated = await deps.repository.setPublicLink(recordId, hashPublicLinkToken(token, deps.publicLinkSecret), encryptPublicLinkToken(token, deps.publicLinkSecret), createdAt, expectedHash);
    if (!updated) {
      const winner = await deps.repository.findById(recordId);
      if (!winner?.public_link_token_ciphertext) return res.status(409).json(errorBody("PUBLIC_LINK_CONFLICT", "O link foi alterado por outra solicitação. Tente novamente.", res.locals.requestId));
      const winnerToken = decryptPublicLinkToken(winner.public_link_token_ciphertext, deps.publicLinkSecret);
      return res.json({ data: { url: publicLinkUrl(winnerToken, deps.publicWebUrl ?? "http://localhost:3000"), createdAt: winner.public_link_created_at } });
    }
    return res.json({ data: { url: publicLinkUrl(token, deps.publicWebUrl ?? "http://localhost:3000"), createdAt } });
  }

  app.put("/api/v1/admin/records/:id/public-link", requireAdmin, async (req, res, next) => {
    try { return await writePublicLink(recordIdSchema.parse(String(req.params.id)), false, res); }
    catch (error) { next(error); }
  });

  app.post("/api/v1/admin/records/:id/public-link/rotate", requireAdmin, async (req, res, next) => {
    try { return await writePublicLink(recordIdSchema.parse(String(req.params.id)), true, res); }
    catch (error) { next(error); }
  });

  app.delete("/api/v1/admin/records/:id/public-link", requireAdmin, async (req, res, next) => {
    try {
      const id = recordIdSchema.parse(String(req.params.id));
      const current = await deps.repository.findById(id);
      if (!current) return res.status(404).json(errorBody("RECORD_NOT_FOUND", "Registro não encontrado.", res.locals.requestId));
      await deps.repository.revokePublicLink(id);
      return res.status(204).send();
    } catch (error) { next(error); }
  });

  app.use((_req, res) => res.status(404).json(errorBody("ROUTE_NOT_FOUND", "Rota não encontrada.", res.locals.requestId ?? randomUUID())));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (typeof error === "object" && error && "status" in error && error.status === 413) {
      return res.status(413).json(errorBody("IMAGE_TOO_LARGE", "A imagem deve ter no máximo 1 MB.", res.locals.requestId));
    }
    if (error instanceof Error && error.message === "PROFILE_PHOTO_TOO_LARGE") {
      return res.status(413).json(errorBody("PROFILE_PHOTO_TOO_LARGE", "A foto processada deve ter no máximo 1 MB.", res.locals.requestId));
    }
    if (error instanceof Error && error.message === "INVALID_PROFILE_PHOTO") {
      return res.status(415).json(errorBody("INVALID_PROFILE_PHOTO", "Envie uma imagem WebP válida.", res.locals.requestId));
    }
    if (error instanceof ZodError) return res.status(400).json({ ...errorBody("VALIDATION_ERROR", "Dados inválidos.", res.locals.requestId), details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    const databaseCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (databaseCode === "23505") return res.status(409).json(errorBody("PROTOCOL_CONFLICT", "Não foi possível gerar um protocolo único. Tente novamente.", res.locals.requestId));
    (deps.log ?? console.error)({ level: "error", event: "unhandled_error", requestId: res.locals.requestId, errorType: error instanceof Error ? error.name : "unknown" });
    return res.status(500).json(errorBody("INTERNAL_ERROR", "Erro interno.", res.locals.requestId));
  });

  return app;
}
