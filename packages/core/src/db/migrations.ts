/** Hand-written DDL so one file runs on PGlite (dev) and Postgres (prod). Idempotent. */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_init",
    sql: `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name text, email text, phone text, linkedin text, website text, location text,
  work_auth jsonb NOT NULL DEFAULT '{}'::jsonb,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_resume_text text,
  resume_auto_approve boolean NOT NULL DEFAULT false,
  review_before_submit boolean NOT NULL DEFAULT true,
  auto_apply_daily_cap integer NOT NULL DEFAULT 0,
  auto_apply_min_score real NOT NULL DEFAULT 0.7,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  label text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  start_date text, end_date text,
  source text, source_quote text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS graph_nodes_user_type_idx ON graph_nodes(user_id, type);
CREATE INDEX IF NOT EXISTS graph_nodes_label_idx ON graph_nodes(user_id, label);
CREATE TABLE IF NOT EXISTS graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  src uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  dst uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS graph_edges_unique ON graph_edges(src, dst, type);
CREATE INDEX IF NOT EXISTS graph_edges_dst_idx ON graph_edges(dst);
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, domain text,
  ats_type text NOT NULL, ats_token text NOT NULL,
  research jsonb, researched_at timestamptz,
  last_polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_ats_unique ON companies(ats_type, ats_token);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  company_name text NOT NULL,
  ats_type text NOT NULL, external_id text NOT NULL,
  title text NOT NULL, location text, remote boolean NOT NULL DEFAULT false,
  description_text text NOT NULL, description_html text,
  apply_url text NOT NULL,
  posted_at timestamptz,
  requirements jsonb,
  discovered_via text NOT NULL DEFAULT 'feed',
  raw jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_ats_external_unique ON jobs(ats_type, external_id);
CREATE INDEX IF NOT EXISTS jobs_posted_idx ON jobs(posted_at);
CREATE TABLE IF NOT EXISTS matches (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score real NOT NULL,
  explanation jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS matches_user_job_unique ON matches(user_id, job_id);
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  resume_id uuid,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  receipt jsonb, error text,
  attempts integer NOT NULL DEFAULT 0,
  resume_approved_at timestamptz, form_approved_at timestamptz, submitted_at timestamptz,
  sheet_row integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS applications_user_job_unique ON applications(user_id, job_id);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status);
CREATE TABLE IF NOT EXISTS resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  content jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  html text, pdf_path text, pages integer,
  ats_score integer,
  ats_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  keyword_coverage real,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'info',
  step text NOT NULL, message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS run_events_app_idx ON run_events(application_id, ts);
CREATE TABLE IF NOT EXISTS inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  external_id text,
  from_address text NOT NULL, subject text NOT NULL, body_text text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'other',
  code text, draft_reply text,
  read boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'composio_gmail'
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_external_unique ON inbox_messages(user_id, external_id);
CREATE INDEX IF NOT EXISTS inbox_user_idx ON inbox_messages(user_id, received_at);
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL, address text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_kind_address_unique ON channels(kind, address);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  role text NOT NULL, content text NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_channel_idx ON conversations(channel_id, ts);
`,
  },
  {
    id: "0002_auth_onboarding",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pronouns text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS willing_to_relocate boolean;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS remote_preference text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS heard_about text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS salary_expectation jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS earliest_start_date text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notice_period_weeks integer;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS eeo jsonb NOT NULL DEFAULT '{"gender":"decline","race":"decline","veteran":"decline","disability":"decline"}'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS security_clearance text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS over18 boolean;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding jsonb NOT NULL DEFAULT '{"step":"resume"}'::jsonb
`,
  },
  {
    id: "0003_agent_events",
    sql: `
CREATE TABLE IF NOT EXISTS agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS agent_events_user_idx ON agent_events(user_id, ts);
CREATE INDEX IF NOT EXISTS agent_events_job_idx ON agent_events(user_id, job_id)
`,
  },
  {
    id: "0004_user_credentials",
    sql: `
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  encrypted_key text,
  base_url text,
  quality_model text,
  bulk_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
`,
  },
  {
    id: "0005_resume_docs",
    sql: `
CREATE TABLE IF NOT EXISTS resume_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  content jsonb NOT NULL,
  template_id text NOT NULL DEFAULT 'classic',
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resume_docs_user_idx ON resume_docs(user_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS resume_docs_one_default ON resume_docs(user_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS resume_doc_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES resume_docs(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name text NOT NULL,
  content jsonb NOT NULL,
  template_id text NOT NULL DEFAULT 'classic',
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resume_doc_versions_doc_idx ON resume_doc_versions(doc_id, version);
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS template_id text NOT NULL DEFAULT 'classic';
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS edited boolean NOT NULL DEFAULT false
`,
  },
  {
    id: "0006_auth_tokens",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
CREATE TABLE IF NOT EXISTS auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens(user_id, kind)
`,
  },
];
