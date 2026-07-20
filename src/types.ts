export type RecordStatus = "active" | "archived";
export type EducationDocumentType = "RG" | "RNE" | "CPF" | "OTHER";

export interface EducationDocument {
  document_type: EducationDocumentType;
  document_number: string;
}

export interface EducationRecord {
  id: string;
  protocol_hash: string;
  protocol_ciphertext: string | null;
  status: RecordStatus;
  student_name: string;
  birth_date: string;
  document_type: EducationDocumentType;
  document_number: string;
  additional_documents: EducationDocument[];
  mother_name: string | null;
  father_name: string | null;
  education_level: string;
  completion_date: string;
  notes: string | null;
  institution_name: string;
  institution_creation_act: string | null;
  publication_text: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export type CreateRecordInput = Omit<
  EducationRecord,
  "id" | "protocol_hash" | "protocol_ciphertext" | "status" | "created_at" | "updated_at" | "created_by"
>;

export type UpdateRecordInput = Partial<CreateRecordInput> & { status?: RecordStatus };

export interface PublicRecord {
  consultedAt: string;
  student: {
    name: string;
    birthDate: string;
    documentType: EducationRecord["document_type"];
    documentNumber: string;
    documents: Array<{ type: EducationDocumentType; number: string }>;
    motherName: string | null;
    fatherName: string | null;
    educationLevel: string;
    completionDate: string;
    notes: string | null;
  };
  institution: {
    name: string;
    creationAct: string | null;
    publicationText: string | null;
  };
  downloads: { pdf: "blocked"; xml: "blocked" };
}
