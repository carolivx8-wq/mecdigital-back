import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateRecordInput, EducationRecord, UpdateRecordInput } from "./types.js";

export interface RecordRepository {
  findByProtocolHash(hash: string): Promise<EducationRecord | null>;
  findActiveByProtocolHash(hash: string): Promise<EducationRecord | null>;
  findByPublicLinkTokenHash(hash: string): Promise<EducationRecord | null>;
  create(input: CreateRecordInput, protocolHash: string, protocolCiphertext: string, userId: string): Promise<EducationRecord>;
  list(page: number, pageSize: number, search: string): Promise<{ items: EducationRecord[]; total: number }>;
  findById(id: string): Promise<EducationRecord | null>;
  update(id: string, input: UpdateRecordInput): Promise<EducationRecord | null>;
  setPublicLink(id: string, tokenHash: string, tokenCiphertext: string, createdAt: string, expectedHash: string | null): Promise<EducationRecord | null>;
  revokePublicLink(id: string): Promise<EducationRecord | null>;
  setProfilePhotoPath(id: string, path: string | null): Promise<EducationRecord | null>;
  delete(id: string): Promise<Pick<EducationRecord, "profile_photo_path"> | null>;
}

export class SupabaseRecordRepository implements RecordRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByProtocolHash(hash: string): Promise<EducationRecord | null> {
    const { data, error } = await this.client
      .from("education_records")
      .select("*")
      .eq("protocol_hash", hash)
      .maybeSingle();
    if (error) throw error;
    return data as EducationRecord | null;
  }

  async findActiveByProtocolHash(hash: string): Promise<EducationRecord | null> {
    const { data, error } = await this.client
      .from("education_records")
      .select("*")
      .eq("protocol_hash", hash)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    return data as EducationRecord | null;
  }

  async findByPublicLinkTokenHash(hash: string): Promise<EducationRecord | null> {
    const { data, error } = await this.client
      .from("education_records")
      .select("*")
      .eq("public_link_token_hash", hash)
      .maybeSingle();
    if (error) throw error;
    return data as EducationRecord | null;
  }

  async create(input: CreateRecordInput, protocolHash: string, protocolCiphertext: string, userId: string): Promise<EducationRecord> {
    const { data, error } = await this.client
      .from("education_records")
      .insert({ ...input, protocol_hash: protocolHash, protocol_ciphertext: protocolCiphertext, created_by: userId })
      .select("*")
      .single();
    if (error) throw error;
    return data as EducationRecord;
  }

  async list(page: number, pageSize: number, search: string) {
    const from = (page - 1) * pageSize;
    let query = this.client
      .from("education_records")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (search) {
      const safeSearch = search.replaceAll(",", "");
      query = query.or(`student_name.ilike.%${safeSearch}%,institution_name.ilike.%${safeSearch}%`);
    }
    const { data, error, count } = await query;
    if (error) throw error;
    return { items: (data ?? []) as EducationRecord[], total: count ?? 0 };
  }

  async findById(id: string): Promise<EducationRecord | null> {
    const { data, error } = await this.client.from("education_records").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as EducationRecord | null;
  }

  async update(id: string, input: UpdateRecordInput): Promise<EducationRecord | null> {
    const { data, error } = await this.client
      .from("education_records")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data as EducationRecord | null;
  }

  async setPublicLink(id: string, tokenHash: string, tokenCiphertext: string, createdAt: string, expectedHash: string | null): Promise<EducationRecord | null> {
    let query = this.client
      .from("education_records")
      .update({ public_link_token_hash: tokenHash, public_link_token_ciphertext: tokenCiphertext, public_link_created_at: createdAt, updated_at: new Date().toISOString() })
      .eq("id", id);
    query = expectedHash === null ? query.is("public_link_token_hash", null) : query.eq("public_link_token_hash", expectedHash);
    const { data, error } = await query
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data as EducationRecord | null;
  }

  async revokePublicLink(id: string): Promise<EducationRecord | null> {
    const { data, error } = await this.client
      .from("education_records")
      .update({ public_link_token_hash: null, public_link_token_ciphertext: null, public_link_created_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data as EducationRecord | null;
  }

  async setProfilePhotoPath(id: string, path: string | null): Promise<EducationRecord | null> {
    const { data, error } = await this.client
      .from("education_records")
      .update({ profile_photo_path: path, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data as EducationRecord | null;
  }

  async delete(id: string): Promise<Pick<EducationRecord, "profile_photo_path"> | null> {
    const { data, error } = await this.client
      .from("education_records")
      .delete()
      .eq("id", id)
      .select("profile_photo_path")
      .maybeSingle();
    if (error) throw error;
    return data as Pick<EducationRecord, "profile_photo_path"> | null;
  }
}
