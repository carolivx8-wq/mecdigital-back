import { z } from "zod";

export const protocolSchema = z.object({
  protocol: z.string().trim().regex(/^MEC-[A-Fa-f0-9]{24}$/, "Protocolo inválido")
});

export const downloadAttemptSchema = protocolSchema.extend({
  format: z.enum(["pdf", "xml"])
});

export const educationDocumentSchema = z.object({
  document_type: z.enum(["RG", "RNE", "CPF", "OTHER"]),
  document_number: z.string().trim().min(3).max(40)
}).strict();

export const educationDocumentsSchema = z.array(educationDocumentSchema).max(9);

export const recordInputSchema = z.object({
  student_name: z.string().trim().min(3).max(180),
  birth_date: z.iso.date(),
  document_type: z.enum(["RG", "RNE", "CPF", "OTHER"]),
  document_number: z.string().trim().min(3).max(40),
  additional_documents: educationDocumentsSchema.default([]),
  mother_name: z.string().trim().min(3).max(180).nullable().default(null),
  father_name: z.string().trim().min(3).max(180).nullable().default(null),
  education_level: z.string().trim().min(2).max(180),
  completion_date: z.iso.date(),
  notes: z.string().trim().max(1000).nullable().default(null),
  institution_name: z.string().trim().min(3).max(220),
  institution_creation_act: z.string().trim().max(1000).nullable().default(null),
  publication_text: z.string().trim().max(1000).nullable().default(null)
}).strict();

export const recordPatchSchema = recordInputSchema.partial().extend({
  additional_documents: educationDocumentsSchema.optional(),
  mother_name: z.string().trim().min(3).max(180).nullable().optional(),
  father_name: z.string().trim().min(3).max(180).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  institution_creation_act: z.string().trim().max(1000).nullable().optional(),
  publication_text: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional()
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).regex(/^[\p{L}\p{N}\s.'-]*$/u, "Busca inválida").default("")
});

export const recordIdSchema = z.uuid();

export const brandingLinkSchema = z.object({
  logoLink: z.string().trim().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Link inválido").nullable()
});
