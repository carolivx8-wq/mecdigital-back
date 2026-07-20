begin;

alter table public.education_records
  add column if not exists profile_photo_path text
  check (profile_photo_path is null or profile_photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 1048576, array['image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;

-- Rollback operacional: manter bucket e coluna; remover a UI/rotas.
-- Rollback destrutivo somente após apagar objetos e confirmar ausência de referências.
