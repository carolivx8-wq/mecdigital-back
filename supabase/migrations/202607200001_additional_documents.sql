begin;

alter table public.education_records
  add column if not exists additional_documents jsonb not null default '[]'::jsonb;

create or replace function public.is_valid_additional_documents(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  item_type text;
  item_number text;
begin
  if value is null or jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 9 then
    return false;
  end if;

  for item in select * from jsonb_array_elements(value)
  loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'document_type')
      or not (item ? 'document_number')
      or item - array['document_type', 'document_number'] <> '{}'::jsonb
      or jsonb_typeof(item -> 'document_type') <> 'string'
      or jsonb_typeof(item -> 'document_number') <> 'string'
    then
      return false;
    end if;

    item_type := item ->> 'document_type';
    item_number := btrim(item ->> 'document_number');
    if item_type not in ('RG', 'RNE', 'CPF', 'OTHER')
      or char_length(item_number) < 3
      or char_length(item_number) > 40
    then
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

alter table public.education_records
  drop constraint if exists education_records_additional_documents_check;

alter table public.education_records
  add constraint education_records_additional_documents_check
  check (public.is_valid_additional_documents(additional_documents));

comment on column public.education_records.additional_documents is
  'Optional identity documents beyond the required primary document; maximum nine.';

commit;

-- Rollback only before production data uses this field:
-- alter table public.education_records drop column if exists additional_documents;
-- drop function if exists public.is_valid_additional_documents(jsonb);
