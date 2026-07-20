begin;

alter table public.education_records
  add column if not exists public_link_token_hash text,
  add column if not exists public_link_token_ciphertext text,
  add column if not exists public_link_created_at timestamptz;

create unique index if not exists education_records_public_link_token_hash_uq
  on public.education_records(public_link_token_hash)
  where public_link_token_hash is not null;

alter table public.education_records
  drop constraint if exists education_records_public_link_state_check,
  add constraint education_records_public_link_state_check check (
    (public_link_token_hash is null and public_link_token_ciphertext is null and public_link_created_at is null)
    or
    (public_link_token_hash is not null and public_link_token_ciphertext is not null and public_link_created_at is not null)
  );

commit;

-- Rollback operacional: desabilitar as rotas e preservar as colunas.
-- Rollback destrutivo somente após revogar links e confirmar ausência de uso.
