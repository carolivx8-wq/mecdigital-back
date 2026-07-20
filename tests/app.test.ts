import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { BrandStore } from "../src/branding.js";
import { encryptProtocol, hashProtocol } from "../src/domain/protocol.js";
import type { RecordRepository } from "../src/repository.js";
import type { CreateRecordInput, EducationRecord, UpdateRecordInput } from "../src/types.js";

const pepper = "test-pepper-with-more-than-thirty-two-characters";
const protocol = "MEC-0123456789ABCDEF01234567";

function fixture(overrides: Partial<EducationRecord> = {}): EducationRecord {
  return {
    id: "6d08350c-5263-4d83-9471-4b5f25246eef",
    protocol_hash: hashProtocol(protocol, pepper),
    protocol_ciphertext: encryptProtocol(protocol, pepper),
    status: "active",
    student_name: "Samara Maria Teixeira Fernandes",
    birth_date: "1979-03-16",
    document_type: "RG",
    document_number: "35383438",
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
  async findActiveByProtocolHash(hash: string) { return this.records.find((item) => item.protocol_hash === hash && item.status === "active") ?? null; }
  async create(input: CreateRecordInput, protocolHash: string, protocolCiphertext: string, userId: string) { const record = fixture({ ...input, protocol_hash: protocolHash, protocol_ciphertext: protocolCiphertext, created_by: userId }); this.records.push(record); return record; }
  async list(_page: number, _pageSize: number, search: string) { const items = this.records.filter((item) => item.student_name.toLowerCase().includes(search.toLowerCase())); return { items, total: items.length }; }
  async findById(id: string) { return this.records.find((item) => item.id === id) ?? null; }
  async update(id: string, input: UpdateRecordInput) { const found = await this.findById(id); if (!found) return null; Object.assign(found, input); return found; }
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
  const app = createApp({
    repository,
    brandStore,
    authorizeAdmin: async (header) => header === "Bearer valid" && admin ? "admin-1" : null,
    protocolPepper: pepper,
    protocolGenerator: () => protocol,
    allowedOrigins: ["http://localhost:3000"],
    log: (entry) => logs.push(entry)
  });
  return { app, repository, brandStore, logs };
}

describe("public protocol contracts", () => {
  it("returns the approved public fields in full with a consultation timestamp and no-store", async () => {
    const { app } = setup();
    const startedAt = Date.now();
    const response = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(response.status).toBe(200);
    expect(response.body.data.student.name).toBe("Samara Maria Teixeira Fernandes");
    expect(response.body.data.student.documentNumber).toBe("35383438");
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

  it("uses the same not-found response for missing and archived records", async () => {
    const { app, repository } = setup();
    const missing = await request(app).post("/api/v1/protocols/lookup").send({ protocol: "MEC-AAAAAAAAAAAAAAAAAAAAAAAA" });
    repository.records[0].status = "archived";
    const archived = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(missing.status).toBe(404);
    expect(archived.status).toBe(404);
    expect(missing.body.error.code).toBe(archived.body.error.code);
  });

  it.each(["pdf", "xml"])("blocks %s downloads at the API", async (format) => {
    const { app } = setup();
    const response = await request(app).post("/api/v1/protocols/download-attempt").send({ protocol, format });
    expect(response.status).toBe(423);
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
    const { id, protocol_hash, protocol_ciphertext, status, created_at, updated_at, created_by, ...input } = source;
    const response = await request(app).post("/api/v1/admin/records").set("authorization", "Bearer valid").send(input);
    expect(response.status).toBe(201);
    expect(response.body.data.protocol).toBe(protocol);
    expect(response.body.data.record).not.toHaveProperty("protocol_hash");
    expect(response.body.data.record).not.toHaveProperty("protocol_ciphertext");
    expect(response.body.data.record).not.toHaveProperty("created_by");
    expect(response.body.data.record.protocol).toBe(protocol);
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

  it("archives a record and removes it from public lookup", async () => {
    const { app, repository } = setup();
    const archived = await request(app)
      .patch(`/api/v1/admin/records/${repository.records[0].id}`)
      .set("authorization", "Bearer valid")
      .send({ status: "archived" });
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("archived");
    const lookup = await request(app).post("/api/v1/protocols/lookup").send({ protocol });
    expect(lookup.status).toBe(404);
  });

  it("blocks and unblocks a record through the existing status contract", async () => {
    const { app, repository } = setup();
    const recordPath = `/api/v1/admin/records/${repository.records[0].id}`;
    expect((await request(app).patch(recordPath).send({ status: "archived" })).status).toBe(401);
    expect((await request(app).patch(recordPath).set("authorization", "Bearer invalid").send({ status: "archived" })).status).toBe(403);
    expect((await request(app).patch(recordPath).set("authorization", "Bearer valid").send({ status: "blocked" })).status).toBe(400);
    expect((await request(app).patch(recordPath).set("authorization", "Bearer valid").send({ status: "archived" })).status).toBe(200);
    expect((await request(app).post("/api/v1/protocols/lookup").send({ protocol })).status).toBe(404);
    const unblocked = await request(app).patch(recordPath).set("authorization", "Bearer valid").send({ status: "active" });
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.data.status).toBe("active");
    expect((await request(app).post("/api/v1/protocols/lookup").send({ protocol })).status).toBe(200);
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
