import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopbarNotifications } from "./topbar-notifications";

afterEach(cleanup);

const pushMock = vi.fn();
const notificationRows: Array<Record<string, unknown>> = [];
const updateCalls: Array<{
  payload: Record<string, unknown>;
  filters: Array<{ type: "eq" | "is"; column: string; value: unknown }>;
}> = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from(table: string) {
      if (table !== "notifications") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select() {
          return {
            order() {
              return {
                limit: async () => ({
                  data: notificationRows.map((row) => ({ ...row })),
                  error: null,
                }),
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          const filters: Array<{ type: "eq" | "is"; column: string; value: unknown }> = [];

          return {
            eq(column: string, value: unknown) {
              filters.push({ type: "eq", column, value });
              return {
                is: async (nextColumn: string, nextValue: unknown) => {
                  filters.push({ type: "is", column: nextColumn, value: nextValue });
                  updateCalls.push({ payload, filters: [...filters] });
                  return { error: null };
                },
              };
            },
            is: async (column: string, value: unknown) => {
              filters.push({ type: "is", column, value });
              updateCalls.push({ payload, filters: [...filters] });
              return { error: null };
            },
          };
        },
      };
    },
  }),
}));

describe("TopbarNotifications", () => {
  beforeEach(() => {
    notificationRows.length = 0;
    updateCalls.length = 0;
    pushMock.mockReset();
  });

  it("shows unread activity from the notifications table and marks all read server-side", async () => {
    notificationRows.push({
      id: "notif-1",
      run_id: "run-1",
      job_id: "job-1",
      title: "Run completed: Alpha",
      body: "Your run finished successfully.",
      level: "success",
      read_at: null,
      created_at: new Date().toISOString(),
    });

    render(<TopbarNotifications />);

    const bellButton = await screen.findByRole("button", { name: "Notifications" });

    await waitFor(() => {
      expect(bellButton.querySelector("span")).not.toBeNull();
    });

    await userEvent.click(bellButton);

    expect(await screen.findByText("Run completed: Alpha")).toBeInTheDocument();
    expect(screen.getByText("Your run finished successfully.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /mark all read/i }));

    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].filters).toEqual([{ type: "is", column: "read_at", value: null }]);
      expect(updateCalls[0].payload.read_at).toEqual(expect.any(String));
      expect(bellButton.querySelector("span")).toBeNull();
    });
  });

  it("marks a clicked notification read and routes to its run", async () => {
    notificationRows.push({
      id: "notif-2",
      run_id: "run-123",
      job_id: "job-123",
      title: "Run failed: Beta",
      body: "The backtest timed out.",
      level: "error",
      read_at: null,
      created_at: new Date().toISOString(),
    });

    render(<TopbarNotifications />);

    const bellButton = await screen.findByRole("button", { name: "Notifications" });
    await userEvent.click(bellButton);
    await userEvent.click(await screen.findByText("Run failed: Beta"));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/runs/run-123");
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].filters).toEqual([
        { type: "eq", column: "id", value: "notif-2" },
        { type: "is", column: "read_at", value: null },
      ]);
    });
  });
});
