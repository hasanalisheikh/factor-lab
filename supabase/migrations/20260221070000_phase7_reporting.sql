-- Phase 7 Reporting migration (idempotent)
-- Run in Supabase SQL Editor or via psql against your Supabase Postgres.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- reports table
CREATE TABLE IF NOT EXISTS public.reports (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id        UUID        NOT NULL REFERENCES public.runs (id) ON DELETE CASCADE,
  storage_path  TEXT        NOT NULL,
  url           TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id)
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reports'
      AND policyname = 'public read'
  ) THEN
    CREATE POLICY "public read"
      ON public.reports
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- Storage bucket for HTML tearsheets
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

-- Public read access for objects in reports bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read reports bucket'
  ) THEN
    CREATE POLICY "Public read reports bucket"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'reports');
  END IF;
END $$;
