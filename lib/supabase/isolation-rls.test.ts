import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260321_isolation_rls.sql",
)

const sql = fs.readFileSync(migrationPath, "utf8")
const queriesSource = fs.readFileSync(
  path.join(process.cwd(), "lib", "supabase", "queries.ts"),
  "utf8",
)

describe("20260321 isolation RLS migration", () => {
  it("removes the legacy runless jobs leak and scopes jobs to owned runs", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "jobs_data_ingest_select" ON public.jobs;')
    expect(sql).toMatch(
      /CREATE POLICY "jobs_select" ON public\.jobs[\s\S]*run_id IS NOT NULL[\s\S]*FROM public\.runs r[\s\S]*r\.id = public\.jobs\.run_id[\s\S]*r\.user_id = auth\.uid\(\)/,
    )
  })

  it("scopes data_ingest_jobs to the requesting user or an owned run", () => {
    expect(sql).toMatch(
      /CREATE POLICY "data_ingest_jobs_select" ON public\.data_ingest_jobs[\s\S]*requested_by_user_id IS NOT NULL AND requested_by_user_id = auth\.uid\(\)[\s\S]*requested_by_run_id[\s\S]*r\.user_id = auth\.uid\(\)/,
    )
  })

  it("keeps notifications owner-only", () => {
    expect(sql).toMatch(
      /CREATE POLICY "notifications_select" ON public\.notifications[\s\S]*user_id IS NOT NULL AND user_id = auth\.uid\(\)/,
    )
  })

  it("uses the session client for auth-scoped run progress reads", () => {
    expect(queriesSource).toMatch(
      /export async function getIngestProgressForRun[\s\S]*const supabase = await createClient\(\)/,
    )
    expect(queriesSource).toMatch(
      /export async function getUniverseBatchStatus[\s\S]*const supabase = await createClient\(\)/,
    )
    expect(queriesSource).toMatch(
      /export async function getActiveRunsProgress[\s\S]*const supabase = await createClient\(\)/,
    )
  })
})
