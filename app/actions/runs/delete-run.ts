"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveReportsBucketName } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { RUN_DELETE_BLOCKED_STATUSES } from "./constants";
import type { DeleteRunActionResult } from "./types";

export async function deleteRunAction(runId: string): Promise<DeleteRunActionResult | never> {
  const parsedRunId = z.string().uuid().safeParse(runId);
  if (!parsedRunId.success) {
    return { error: "Invalid run ID." };
  }

  const serverClient = await createClient();
  const {
    data: { user },
    error: userError,
  } = await serverClient.auth.getUser();
  if (userError || !user) {
    return { error: "Authentication required. Please sign in." };
  }

  const { data: run, error: runError } = await serverClient
    .from("runs")
    .select("id, status, user_id")
    .eq("id", parsedRunId.data)
    .maybeSingle();

  if (runError) {
    console.error("deleteRunAction run lookup error:", runError.message);
    return { error: "Unable to load this run right now." };
  }

  if (!run || run.user_id !== user.id) {
    return { error: "You can only delete your own runs." };
  }

  if (RUN_DELETE_BLOCKED_STATUSES.has(run.status)) {
    return { error: "Delete is disabled while this run is queued, running, or waiting for data." };
  }

  const admin = createAdminClient();
  const { data: reportRow, error: reportError } = await admin
    .from("reports")
    .select("storage_path")
    .eq("run_id", parsedRunId.data)
    .maybeSingle();

  if (reportError) {
    console.error("deleteRunAction report lookup error:", reportError.message);
    return { error: "Unable to clean up this run's report." };
  }

  if (reportRow?.storage_path) {
    const reportsBucket = resolveReportsBucketName(process.env.SUPABASE_REPORTS_BUCKET);
    const { error: storageError } = await admin.storage
      .from(reportsBucket)
      .remove([reportRow.storage_path]);

    if (storageError) {
      const message = storageError.message.toLowerCase();
      const isMissingObject = message.includes("not found") || message.includes("does not exist");
      if (!isMissingObject) {
        console.error("deleteRunAction storage cleanup error:", storageError.message);
        return { error: "Unable to delete the stored report for this run." };
      }
    }
  }

  // data_ingest_jobs links use ON DELETE SET NULL, so delete them explicitly
  // before removing the run to avoid leaving orphaned preflight jobs behind.
  const { error: ingestDeleteError } = await admin
    .from("data_ingest_jobs")
    .delete()
    .eq("requested_by_run_id", parsedRunId.data);

  if (
    ingestDeleteError &&
    !ingestDeleteError.message.toLowerCase().includes("could not find the table")
  ) {
    console.error("deleteRunAction data_ingest_jobs cleanup error:", ingestDeleteError.message);
    return { error: "Unable to delete linked ingest jobs for this run." };
  }

  const { error: deleteError } = await serverClient
    .from("runs")
    .delete()
    .eq("id", parsedRunId.data);

  if (deleteError) {
    console.error("deleteRunAction run delete error:", deleteError.message);
    return { error: "Unable to delete this run right now." };
  }

  revalidatePath("/runs");
  revalidatePath("/dashboard");
  redirect("/runs?deleted=1");
}
