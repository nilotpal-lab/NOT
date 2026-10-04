create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  class smallint not null check (class between 6 and 10),
  subject text not null check (subject in ('History','Geography','Civics','Economics','SocialScience')),
  chapter_no smallint not null check (chapter_no between 1 and 99),
  title text not null check (length(title) between 2 and 200),
  book text, edition text,
  created_at timestamptz not null default now(),
  unique (class, subject, chapter_no)
);

create index if not exists chapters_title_trgm on chapters using gin (title gin_trgm_ops);

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  kind text not null check (kind in ('ncert_pdf','ppt','ppt_pdf','teacher_notes')),
  parent_file_id uuid references files(id) on delete cascade,
  file_name text not null unique,
  teacher_name text,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 209715200),
  part_count smallint not null default 1,
  mime text not null check (mime in ('application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation')),
  sha256 text not null,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  unique (chapter_id, sha256)
);

create index if not exists files_chapter on files(chapter_id);
create index if not exists files_name_trgm on files using gin (file_name gin_trgm_ops);

create table if not exists file_parts (
  file_id uuid not null references files(id) on delete cascade,
  part_no smallint not null check (part_no >= 1),
  tg_file_id text not null,
  tg_file_unique_id text not null,
  tg_message_id bigint not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 19922944),
  sha256 text not null,
  primary key (file_id, part_no)
);

alter table chapters enable row level security;
alter table files enable row level security;
alter table file_parts enable row level security;
