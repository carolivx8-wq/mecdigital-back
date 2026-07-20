import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { educationDocumentsSchema } from "../schemas.js";
import type { EducationRecord, PublicRecord } from "../types.js";

const PROTOCOL_PATTERN = /^MEC-[A-F0-9]{24}$/;

export function generateProtocol(): string {
  return `MEC-${randomBytes(12).toString("hex").toUpperCase()}`;
}

export function normalizeProtocol(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidProtocol(value: string): boolean {
  return PROTOCOL_PATTERN.test(normalizeProtocol(value));
}

export function hashProtocol(protocol: string, pepper: string): string {
  if (pepper.length < 32) throw new Error("PROTOCOL_PEPPER must have at least 32 characters");
  return createHmac("sha256", pepper).update(normalizeProtocol(protocol)).digest("hex");
}

function encryptionKey(pepper: string): Buffer {
  if (pepper.length < 32) throw new Error("PROTOCOL_PEPPER must have at least 32 characters");
  return createHash("sha256").update(`mecdigital-protocol-encryption-v1:${pepper}`).digest();
}

export function encryptProtocol(protocol: string, pepper: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(pepper), iv);
  const encrypted = Buffer.concat([cipher.update(normalizeProtocol(protocol), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptProtocol(payload: string, pepper: string): string {
  const [version, iv, tag, encrypted] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted protocol payload");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(pepper), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function toPublicRecord(record: EducationRecord, profilePhotoUrl: string | null = null): PublicRecord {
  const additionalDocuments = educationDocumentsSchema.parse(record.additional_documents ?? []);
  return {
    consultedAt: new Date().toISOString(),
    student: {
      name: record.student_name,
      profilePhotoUrl,
      birthDate: record.birth_date,
      documentType: record.document_type,
      documentNumber: record.document_number,
      documents: [
        { type: record.document_type, number: record.document_number },
        ...additionalDocuments.map((document) => ({
          type: document.document_type,
          number: document.document_number
        }))
      ],
      motherName: record.mother_name,
      fatherName: record.father_name,
      educationLevel: record.education_level,
      completionDate: record.completion_date,
      notes: record.notes
    },
    institution: {
      name: record.institution_name,
      creationAct: record.institution_creation_act,
      publicationText: record.publication_text
    },
    downloads: { pdf: "blocked", xml: "blocked" }
  };
}
