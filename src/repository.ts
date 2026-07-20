import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateRecordInput, EducationRecord, UpdateRecordInput } from "./types.js";

export interface RecordRepository {
  findByProtocolHash(hash: string): Promise<EducationRecord | null>;
  findActiveByProtocolHash(hash: string): Promise<EducationRecord | null>;
  create(input: CreateRecordInput, protocolHash: string, protocolCiphertext: string, userId: string): Promise<EducationRecord>;
  list(page: number, pageSize: number, search: string): Promise<{ items: EducationRecord[]; total: number }>;
  findById(id: string): Promise<EducationRecord | null>;
  update(id: string, input: UpdateRecordInput): Promise<EducationRecord | null>;
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
}
