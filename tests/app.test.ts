import request from "supertest";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { BrandStore } from "../src/branding.js";
import { encryptProtocol, hashProtocol } from "../src/domain/protocol.js";
import { encryptPublicLinkToken, generatePublicLinkToken, hashPublicLinkToken } from "../src/domain/public-link.js";
import type { RecordRepository } from "../src/repository.js";
import type { ProfilePhotoStore } from "../src/profile-photo.js";
import type { CreateRecordInput, EducationRecord, UpdateRecordInput } from "../src/types.js";

const pepper = "test-pepper-with-more-than-thirty-two-characters";
const protocol = "MEC-0123456789ABCDEF01234567";
const publicLinkSecret = "public-link-secret-with-more-than-thirty-two-characters";
const webpFixture = () => sharp({ create: { width: 40, height: 40, channels: 3, background: "#224466" } }).webp().toBuffer();

function fixture(overrides: Partial<EducationRecord> = {}): EducationRecord {
  return {
    id: "6d08350c-5263-4d83-9471-4b5f25246eef",
    protocol_hash: hashProtocol(protocol, pepper),
    protocol_ciphertext: encryptProtocol(protocol, pepper),
    public_link_token_hash: null,
    public_link_token_ciphertext: null,
    public_link_created_at: null,
    profile_photo_path: null,
    status: "active",
    student_name: "Samara Maria Teixeira Fernandes",
    birth_date: "1979-03-16",
    document_type: "RG",
    document_number: "35383438",
    additional_documents: [{ document_type: "CPF", document_number: "12345678910" }],
    mother_name: "Zilma Teixeira de Farias",
    father_name: "Paulo Fernandes de Farias",
    education_level: "Enfermagem (Bacharelado)",
    completion_date: "2025-12-19",
    notes: "APROVADO",
    institution_name: "Universidade Exemplo",
    institution_creation_act: "Decreto 123",
    publication_text: "Publicação processada",
    created_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T00:00:00.000Z",
    created_by: "admin-1",
    ...overrides
  };
}

class MemoryRepository implements RecordRepository {
  records = [fixture()];
  async findByProtocolHash(hash: string) { return this.records.find((item) => item.protocol_hash === hash) ?? null; }
  async findActiveByProtocolHash(hash: string) { return this.records.find((item) => item.protocol_hash === hash && item.status === "active") ?? null; }
  async findByPublicLinkTokenHash(hash: string) { return this.records.find((item) => item.public_link_token_hash === hash) ?? null; }
  async create(input: CreateRecordInput, protocolHash: string, protocolCiphertext: string, userId: string) { const record = fixture({ ...input, protocol_hash: protocolHash, protocol_ciphertext: protocolCiphertext, created_by: userId }); this.records.push(record); return record; }
  async list(_page: number, _pageSize: number, search: string) { const items = this.records.filter((item) => item.student_name.toLowerCase().includes(search.toLowerCase())); return { items, total: items.length }; }
  async findById(id: string) { return this.records.find((item) => item.id === id) ?? null; }
  async update(id: string, input: UpdateRecordInput) { const found = await this.findById(id); if (!found) return null; Object.assign(found, input); return found; }
  async setPublicLink(id: string, tokenHash: string, tokenCiphertext: string, createdAt: string, expectedHash: string | null) { const found = await this.findById(id); if (!found || found.public_link_token_hash !== expectedHash) return null; Object.assign(found, { public_link_token_hash: tokenHash, public_link_token_ciphertext: tokenCiphertext, public_link_created_at: createdAt }); return found; }
  async revokePublicLink(id: string) { const found = await this.findById(id); if (!found) return null; Object.assign(found, { public_link_token_hash: null, public_link_token_ciphertext: null, public_link_created_at: null }); return found; }
  async setProfilePhotoPath(id: string, path: string | null) { const found = await this.findById(id); if (!found) return null; found.profile_photo_path = path; return found; }
  async delete(id: string) { const index = this.records.findIndex((item) => item.id === id); if (index < 0) return null; return this.records.splice(index, 1)[0]; }
}

class MemoryProfilePhotoStore implements ProfilePhotoStore {
  files = new Map<string, Buffer>();
  failRemove = false;
  failSignedUrl = false;
  async upload(recordId: string, bytes: Buffer) { const path = `${recordId}/11111111-1111-4111-8111-111111111111.webp`; this.files.set(path, bytes); return path; }
  async remove(path: string) { if (this.failRemove) throw new Error("storage remove failed"); this.files.delete(path); }
  async createSignedUrl(path: string) { if (this.failSignedUrl) throw new Error("sign failed"); return `https://signed.example/${path}?token=short-lived`; }
}

class MemoryBrandStore implements BrandStore {
  logoUrl: string | null = null;
  logoLink: string | null = null;
  async getBranding() { return { logoUrl: this.logoUrl, logoLink: this.logoLink }; }
  async uploadLogo(_bytes: Buffer, _contentType: string) { this.logoUrl = "https://cdn.example/logo?v=1"; return this.logoUrl; }
  async deleteLogo() { this.logoUrl = null; }
  async updateLogoLink(logoLink: string | null) { this.logoLink = logoLink; }
}

function setup(admin = true) {
  const repository = new MemoryRepository();
  const logs: Record<string, unknown>[] = [];
  const brandStore = new MemoryBrandStore();
  const profilePhotoStore = new MemoryProfilePhotoStore();
  const app = createApp({
    repository,
    brandStore,
    profilePhotoStore,
    authorizeAdmin: async (header) => header === "Bearer valid" && admin ? "admin-1" : null,
    protocolPepper: pepper,
    publicLinkSecret,
    publicWebUrl: "https://portal-mec.digital",
    protocolGenerator: () => protocol,
    allowedOrigins: ["http://localhost:3000"],
    log: (entry) => logs.push(entry)
  });
  return { app, repository, brandStore, profilePhotoStore, logs };
}

describe("public link contracts", () => {
  it("generates a persistent link, resolves it, rotates it and revokes it", async () => {
    const { app, repository } = setup();
    const recordPath = `/api/v1/admin/records/${repository.records[0].id}/public-link`;
    const authorization = { authorization: "Bearer valid" };

    const generated = await request(app).put(recordPath).set(authorization);
    expect(generated.status).toBe(200);
    expect(generated.body.data.url).toMatch(/^https?:\/\/.+\/registro\/compartilhado#/);
    const token = new URL(generated.body.data.url).hash.slice(1);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(generated.body.data.url).not.toContain(protocol);
    expect(repository.records[0].public_link_token_hash).toBe(hashPublicLinkToken(token, publicLinkSecret));
    expect(repository.records[0].public_link_token_ciphertext).not.toContain(token);

    const repeated = await request(app).put(recordPath).set(authorization);
    expect(repeated.body.data.url).toBe(generated.body.data.url);

    const resolved = await request(app).post("/api/v1/public-links/resolve").send({ token });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.student.name).toBe("Samara Maria Teixeira Fernandes");
    expect(resolved.headers["cache-control"]).toBe("private, no-store");

    const rotated = await request(app).post(`${recordPath}/rotate`).set(authorization);
    const rotatedToken = new URL(rotated.body.data.url).hash.slice(1);
    expect(rotatedToken).not.toBe(token);
    expect((await request(app).post("/api/v1/public-links/resolve").send({ token })).status).toBe(404);
    expect((await request(app).post("/api/v1/public-links/resolve").send({ token: rotatedToken })).status).toBe(200);

    expect((await request(app).delete(recordPath).set(authorization)).status).toBe(204);
    expect((await request(app).post("/api/v1/public-links/resolve").send({ token: rotatedToken })).status).toBe(404);
    expect((await request(app).delete(recordPath).set(authorization)).status).toBe(204);
  });

  it("blocks a valid public link without returning personal data", async () => {
    const { app, repository } = setup();
    const token = generatePublicLinkToken();
    await repository.setPublicLink(repository.records[0].id, hashPublicLinkToken(token, publicLinkSecret), encryptPublicLinkToken(token, publicLinkSecret), new Date().toISOString(), null);
    repository.records[0].status = "archived";
    const response = await request(app).post("/api/v1/public-links/resolve").send({ token });
    expect(response.status).toBe(423);
    expect(response.body.error.code).toBe("PROTOCOL_BLOCKED");
    expect(response.body).not.toHaveProperty("data");
  });

  it("protects public-link administration", async () => {
    const { app, repository } = setup();
    const path = `/api/v1/admin/records/${repository.records[0].id}/public-link`;
    expect((await request(app).put(path)).status).toBe(401);
    expect((await request(app).put(path).set("authorization", "Bearer invalid")).status).toBe(403);
  });

  it("returns the same not-found contract for malformed and unknown public tokens", async () => {
    const { app } = setup();
    const malformed = await request(app).post("/api/v1/public-links/resolve").send({ token: "curto" });
    const unknown = await request(app).post("/api/v1/public-links/resolve").send({ token: "A".repeat(43) });
    expect(malformed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(malformed.body.error.code).toBe("PUBLIC_LINK_NOT_FOUND");
    expect(unknown.body.error.code).toBe("PUBLIC_LINK_NOT_FOUND");
  });

  it("returns the single persisted link for concurrent generation", async () => {
    const { app, repository } = setup();
    const path = `/api/v1/admin/records/${repository.records[0].id}/public-link`;
    const [first, second] = await Promise.all([
      request(app).put(path).set("authorization", "Bearer valid"),
      request(app).put(path).set("authorization", "Bearer valid")
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.url).toBe(second.body.data.url);
    const token = new URL(first.body.data.url).hash.slice(1);
    expect((await request(app).post("/api/v1/public-links/resolve").send({ token })).status).toBe(200);
  });
});

describe("profile photo contracts", () => {
  it("uploads, signs, exposes and removes a private profile photo", async () => {
    const { app, repository, profilePhotoStore } = setup();
    const path = `/api/v1/admin/records/${repository.records[0].id}/profile-photo`;
    const uploaded = await request(app).put(path).set("authorization", "Bearer valid").set("content-type", "image/webp").send(await webpFixture());
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.data.profilePhotoUrl).toContain("https://signed.example/");
    expect(repository.records[0].profile_photo_path).toMatch(/\.webp$/);
    expect(profilePhotoStore.files.size).toBe(1);

    const lookup = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(lookup.body.data.student.profilePhotoUrl).toContain("https://signed.example/");
    expect(lookup.body.data).not.toHaveProperty("profile_photo_path");

    expect((await request(app).delete(path).set("authorization", "Bearer valid")).status).toBe(204);
    expect(repository.records[0].profile_photo_path).toBeNull();
    expect(profilePhotoStore.files.size).toBe(0);
  });

  it("rejects unauthorized and invalid profile photos", async () => {
    const { app, repository } = setup();
    const path = `/api/v1/admin/records/${repository.records[0].id}/profile-photo`;
    expect((await request(app).put(path).set("content-type", "image/webp").send(await webpFixture())).status).toBe(401);
    expect((await request(app).put(path).set("authorization", "Bearer valid").set("content-type", "image/webp").send(Buffer.from("not-webp"))).status).toBe(415);
  });

  it("keeps the new photo consistent when old-object cleanup fails", async () => {
    const { app, repository, profilePhotoStore, logs } = setup();
    const oldPath = `${repository.records[0].id}/00000000-0000-4000-8000-000000000000.webp`;
    repository.records[0].profile_photo_path = oldPath;
    profilePhotoStore.files.set(oldPath, Buffer.from("old"));
    profilePhotoStore.failRemove = true;
    const path = `/api/v1/admin/records/${repository.records[0].id}/profile-photo`;

    const response = await request(app).put(path).set("authorization", "Bearer valid").set("content-type", "image/webp").send(await webpFixture());

    expect(response.status).toBe(200);
    expect(repository.records[0].profile_photo_path).not.toBe(oldPath);
    expect(profilePhotoStore.files.has(repository.records[0].profile_photo_path!)).toBe(true);
    expect(logs).toContainEqual(expect.objectContaining({ event: "profile_photo_cleanup_failed" }));
  });

  it("does not delete a persisted new photo when URL signing fails", async () => {
    const { app, repository, profilePhotoStore } = setup();
    profilePhotoStore.failSignedUrl = true;
    const path = `/api/v1/admin/records/${repository.records[0].id}/profile-photo`;

    const response = await request(app).put(path).set("authorization", "Bearer valid").set("content-type", "image/webp").send(await webpFixture());

    expect(response.status).toBe(500);
    expect(repository.records[0].profile_photo_path).toMatch(/\.webp$/);
    expect(profilePhotoStore.files.has(repository.records[0].profile_photo_path!)).toBe(true);
  });

  it("finishes deletion coherently and logs when storage cleanup fails", async () => {
    const { app, repository, profilePhotoStore, logs } = setup();
    const oldPath = `${repository.records[0].id}/00000000-0000-4000-8000-000000000000.webp`;
    repository.records[0].profile_photo_path = oldPath;
    profilePhotoStore.files.set(oldPath, Buffer.from("old"));
    profilePhotoStore.failRemove = true;
    const path = `/api/v1/admin/records/${repository.records[0].id}/profile-photo`;

    const response = await request(app).delete(path).set("authorization", "Bearer valid");

    expect(response.status).toBe(204);
    expect(repository.records[0].profile_photo_path).toBeNull();
    expect(logs).toContainEqual(expect.objectContaining({ event: "profile_photo_cleanup_failed" }));
  });
});

describe("record deletion contracts", () => {
  it("permanently deletes the record, revokes public access and removes its photo", async () => {
    const { app, repository, profilePhotoStore } = setup();
    const record = repository.records[0];
    const token = generatePublicLinkToken();
    await repository.setPublicLink(record.id, hashPublicLinkToken(token, publicLinkSecret), encryptPublicLinkToken(token, publicLinkSecret), new Date().toISOString(), null);
    record.profile_photo_path = `${record.id}/00000000-0000-4000-8000-000000000000.webp`;
    profilePhotoStore.files.set(record.profile_photo_path, Buffer.from("photo"));
    const path = `/api/v1/admin/records/${record.id}`;

    expect((await request(app).delete(path).set("authorization", "Bearer valid")).status).toBe(204);
    expect(repository.records).toHaveLength(0);
    expect(profilePhotoStore.files.size).toBe(0);
    expect((await request(app).post("/api/v1/protocols/lookup").send({ protocol })).status).toBe(404);
    expect((await request(app).post("/api/v1/public-links/resolve").send({ token })).status).toBe(404);
    const repeated = await request(app).delete(path).set("authorization", "Bearer valid");
    expect(repeated.status).toBe(404);
    expect(repeated.body.error.code).toBe("RECORD_NOT_FOUND");
  });

  it("protects deletion and validates the record id", async () => {
    const { app, repository } = setup();
    const path = `/api/v1/admin/records/${repository.records[0].id}`;
    const unauthorized = await request(app).delete(path);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers["cache-control"]).toBe("private, no-store");
    expect((await request(app).delete(path).set("authorization", "Bearer invalid")).status).toBe(403);
    expect((await request(app).delete("/api/v1/admin/records/not-a-uuid").set("authorization", "Bearer valid")).status).toBe(400);
    expect(repository.records).toHaveLength(1);
  });

  it("keeps deletion successful and logs safely when photo cleanup fails", async () => {
    const { app, repository, profilePhotoStore, logs } = setup();
    const record = repository.records[0];
    record.profile_photo_path = `${record.id}/00000000-0000-4000-8000-000000000000.webp`;
    profilePhotoStore.failRemove = true;

    const response = await request(app).delete(`/api/v1/admin/records/${record.id}`).set("authorization", "Bearer valid");

    expect(response.status).toBe(204);
    expect(repository.records).toHaveLength(0);
    expect(logs).toContainEqual(expect.objectContaining({ event: "record_profile_photo_cleanup_failed" }));
    expect(JSON.stringify(logs)).not.toContain(record.profile_photo_path);
    expect(JSON.stringify(logs)).not.toContain(record.student_name);
  });
});

describe("public protocol contracts", () => {
  it("returns the approved public fields in full with a consultation timestamp and no-store", async () => {
    const { app } = setup();
    const startedAt = Date.now();
    const response = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(response.status).toBe(200);
    expect(response.body.data.student.name).toBe("Samara Maria Teixeira Fernandes");
    expect(response.body.data.student.documentNumber).toBe("35383438");
    expect(response.body.data.student.documents).toEqual([
      { type: "RG", number: "35383438" },
      { type: "CPF", number: "12345678910" }
    ]);
    expect(response.body.data.student.birthDate).toBe("1979-03-16");
    expect(response.body.data.student.motherName).toBe("Zilma Teixeira de Farias");
    expect(response.body.data.student.fatherName).toBe("Paulo Fernandes de Farias");
    expect(new Date(response.body.data.consultedAt).getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.data).not.toHaveProperty("protocol_hash");
    expect(response.body.data).not.toHaveProperty("protocol_ciphertext");
    expect(response.body.data).not.toHaveProperty("created_by");
    expect(response.body.data.downloads).toEqual({ pdf: "blocked", xml: "blocked" });
  });

  it("blocks archived records without returning their data", async () => {
    const { app, repository } = setup();
    const missing = await request(app).post("/api/v1/protocols/lookup").send({ protocol: "MEC-AAAAAAAAAAAAAAAAAAAAAAAA" });
    repository.records[0].status = "archived";
    const archived = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(missing.status).toBe(404);
    expect(missing.headers["cache-control"]).toBe("private, no-store");
    expect(archived.status).toBe(423);
    expect(archived.headers["cache-control"]).toBe("private, no-store");
    expect(archived.body.error.code).toBe("PROTOCOL_BLOCKED");
    expect(archived.body).not.toHaveProperty("data");
    expect(JSON.stringify(archived.body)).not.toContain(repository.records[0].student_name);
    expect(JSON.stringify(archived.body)).not.toContain(repository.records[0].document_number);
  });

  it.each(["pdf", "xml"])("blocks %s downloads at the API", async (format) => {
    const { app } = setup();
    const response = await request(app).post("/api/v1/protocols/download-attempt").send({ protocol, format });
    expect(response.status).toBe(423);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.error.code).toBe("PROTOCOL_BLOCKED");
    expect(response.body).not.toHaveProperty("url");
  });

  it("rejects malformed protocols", async () => {
    const { app } = setup();
    const response = await request(app).post("/api/v1/protocols/lookup").send({ protocol: "123" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not log request bodies or protocol values", async () => {
    const { app, logs } = setup();
    const response = await request(app).post("/api/v1/protocols/lookup").set("x-request-id", protocol).send({ protocol });
    expect(JSON.stringify(logs)).not.toContain(protocol);
    expect(JSON.stringify(logs)).not.toContain("Samara");
    expect(response.headers["x-request-id"]).not.toBe(protocol);
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("rate limits repeated public lookup attempts", async () => {
    const { app } = setup();
    let response = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    for (let attempt = 1; attempt < 31; attempt += 1) {
      response = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    }
    expect(response.status).toBe(429);
  });
});

describe("admin contracts", () => {
  it("requires an authenticated promoted admin", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/v1/admin/records")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/records").set("authorization", "Bearer invalid")).status).toBe(403);
  });

  it("creates a record and reveals the protocol once", async () => {
    const { app } = setup();
    const source = fixture();
    const { id, protocol_hash, protocol_ciphertext, public_link_token_hash, public_link_token_ciphertext, public_link_created_at, profile_photo_path, status, created_at, updated_at, created_by, ...input } = source;
    const response = await request(app).post("/api/v1/admin/records").set("authorization", "Bearer valid").send(input);
    expect(response.status).toBe(201);
    expect(response.body.data.protocol).toBe(protocol);
    expect(response.body.data.record).not.toHaveProperty("protocol_hash");
    expect(response.body.data.record).not.toHaveProperty("protocol_ciphertext");
    expect(response.body.data.record).not.toHaveProperty("created_by");
    expect(response.body.data.record.protocol).toBe(protocol);
    expect(response.body.data.record.additional_documents).toEqual([{ document_type: "CPF", document_number: "12345678910" }]);
  });

  it("rejects more than nine additional documents", async () => {
    const { app } = setup();
    const source = fixture();
    const { id, protocol_hash, protocol_ciphertext, status, created_at, updated_at, created_by, ...input } = source;
    const response = await request(app)
      .post("/api/v1/admin/records")
      .set("authorization", "Bearer valid")
      .send({
        ...input,
        additional_documents: Array.from({ length: 10 }, (_, index) => ({
          document_type: "OTHER",
          document_number: `DOC-${index + 1}`
        }))
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns the decrypted protocol only to the admin list", async () => {
    const { app } = setup();
    const response = await request(app).get("/api/v1/admin/records").set("authorization", "Bearer valid");
    expect(response.status).toBe(200);
    expect(response.body.data[0].protocol).toBe(protocol);
    expect(response.body.data[0]).not.toHaveProperty("protocol_ciphertext");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("marks every authenticated administrative record response as private and no-store", async () => {
    const { app, repository } = setup();
    const authorization = { authorization: "Bearer valid" };
    const list = await request(app).get("/api/v1/admin/records").set(authorization);
    const detail = await request(app).get(`/api/v1/admin/records/${repository.records[0].id}`).set(authorization);
    const updated = await request(app).patch(`/api/v1/admin/records/${repository.records[0].id}`).set(authorization).send({ status: "archived" });
    for (const response of [list, detail, updated]) {
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("archives a record and blocks public lookup", async () => {
    const { app, repository } = setup();
    const archived = await request(app)
      .patch(`/api/v1/admin/records/${repository.records[0].id}`)
      .set("authorization", "Bearer valid")
      .send({ status: "archived" });
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("archived");
    const lookup = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(lookup.status).toBe(423);
    expect(lookup.body.error.code).toBe("PROTOCOL_BLOCKED");
  });

  it("blocks and unblocks a record through the existing status contract", async () => {
    const { app, repository } = setup();
    const recordPath = `/api/v1/admin/records/${repository.records[0].id}`;
    expect((await request(app).patch(recordPath).send({ status: "archived" })).status).toBe(401);
    expect((await request(app).patch(recordPath).set("authorization", "Bearer invalid").send({ status: "archived" })).status).toBe(403);
    expect((await request(app).patch(recordPath).set("authorization", "Bearer valid").send({ status: "blocked" })).status).toBe(400);
    expect((await request(app).patch(recordPath).set("authorization", "Bearer valid").send({ status: "archived" })).status).toBe(200);
    expect(repository.records[0].additional_documents).toEqual([{ document_type: "CPF", document_number: "12345678910" }]);
    const blockedLookup = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(blockedLookup.status).toBe(423);
    expect(blockedLookup.body.error.code).toBe("PROTOCOL_BLOCKED");
    const unblocked = await request(app).patch(recordPath).set("authorization", "Bearer valid").send({ status: "active" });
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.data.status).toBe("active");
    const activeLookup = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(activeLookup.status).toBe(200);
  });
});

describe("branding contracts", () => {
  it("returns the current public logo without authentication", async () => {
    const { app, brandStore } = setup();
    brandStore.logoUrl = "https://cdn.example/logo?v=1";
    const response = await request(app).get("/api/v1/branding");
    expect(response.status).toBe(200);
    expect(response.body.data.logoUrl).toBe(brandStore.logoUrl);
    expect(response.body.data.logoLink).toBeNull();
  });

  it("only lets an admin upload supported images", async () => {
    const { app } = setup();
    expect((await request(app).put("/api/v1/admin/branding/logo").set("content-type", "image/png").send(Buffer.from("png"))).status).toBe(401);
    const unsupported = await request(app).put("/api/v1/admin/branding/logo").set("authorization", "Bearer valid").set("content-type", "image/svg+xml").send("<svg />");
    expect(unsupported.status).toBe(415);
    const uploaded = await request(app).put("/api/v1/admin/branding/logo").set("authorization", "Bearer valid").set("content-type", "image/png").send(Buffer.from("png"));
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.data.logoUrl).toContain("logo");
  });

  it("lets an admin remove the logo and leave the brand area blank", async () => {
    const { app, brandStore } = setup();
    brandStore.logoUrl = "https://cdn.example/logo?v=1";
    const response = await request(app).delete("/api/v1/admin/branding/logo").set("authorization", "Bearer valid");
    expect(response.status).toBe(204);
    expect(brandStore.logoUrl).toBeNull();
  });

  it("validates and saves the logo destination link", async () => {
    const { app, brandStore } = setup();
    const invalid = await request(app).put("/api/v1/admin/branding/link").set("authorization", "Bearer valid").send({ logoLink: "javascript:alert(1)" });
    expect(invalid.status).toBe(400);
    const saved = await request(app).put("/api/v1/admin/branding/link").set("authorization", "Bearer valid").send({ logoLink: "https://example.com/destino" });
    expect(saved.status).toBe(200);
    expect(brandStore.logoLink).toBe("https://example.com/destino");
  });
});
