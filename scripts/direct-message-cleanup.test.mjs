import { describe, expect, it, vi } from "vitest";

import {
  executeCleanupCommand,
  parseCleanupArgs,
} from "./direct-message-cleanup.mjs";

describe("parseCleanupArgs", () => {
  it("defaults to a bounded dry-run preview", () => {
    expect(parseCleanupArgs([])).toEqual({
      mode: "preview",
      batchSize: 100,
      evaluationTime: undefined,
    });
  });

  it("accepts an explicit preview clock and batch size", () => {
    expect(
      parseCleanupArgs([
        "--batch-size=25",
        "--as-of=2026-09-11T00:00:00.000Z",
      ]),
    ).toEqual({
      mode: "preview",
      batchSize: 25,
      evaluationTime: "2026-09-11T00:00:00.000Z",
    });
  });

  it("requires a deliberate confirmation before execute mode", () => {
    expect(() => parseCleanupArgs(["--execute"])).toThrow(
      "--confirm=DELETE_DIRECT_MESSAGES",
    );

    expect(
      parseCleanupArgs([
        "--execute",
        "--confirm=DELETE_DIRECT_MESSAGES",
        "--batch-size=10",
      ]),
    ).toEqual({
      mode: "execute",
      batchSize: 10,
      evaluationTime: undefined,
    });
  });

  it("does not allow callers to choose the execute clock", () => {
    expect(() =>
      parseCleanupArgs([
        "--execute",
        "--confirm=DELETE_DIRECT_MESSAGES",
        "--as-of=2026-09-11T00:00:00.000Z",
      ]),
    ).toThrow("--as-of can only be used in preview mode");
  });

  it("rejects invalid or unknown options", () => {
    expect(() => parseCleanupArgs(["--batch-size=0"])).toThrow(
      "between 1 and 1000",
    );
    expect(() => parseCleanupArgs(["--unknown"])).toThrow(
      "Unknown option",
    );
  });
});

describe("executeCleanupCommand", () => {
  const environment = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  };

  it("uses the service-role client and preview RPC by default", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ audit_id: 7, candidate_count: 2, message_ids: [8, 9] }],
      error: null,
    });
    const createClient = vi.fn(() => ({ rpc }));
    const log = vi.fn();

    const result = await executeCleanupCommand({
      args: [],
      environment,
      createClient,
      log,
    });

    expect(createClient).toHaveBeenCalledWith(
      environment.SUPABASE_URL,
      environment.SUPABASE_SERVICE_ROLE_KEY,
      expect.objectContaining({ auth: { persistSession: false } }),
    );
    expect(rpc).toHaveBeenCalledWith("preview_direct_message_cleanup", {
      evaluation_time: undefined,
      requested_batch_size: 100,
    });
    expect(result).toEqual({
      mode: "preview",
      auditId: 7,
      count: 2,
      messageIds: [8, 9],
      status: "completed",
    });
  });

  it("calls execute RPC only after explicit confirmation", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ audit_id: 8, deleted_count: 1, message_ids: [9], result_status: "completed" }],
      error: null,
    });

    const result = await executeCleanupCommand({
      args: ["--execute", "--confirm=DELETE_DIRECT_MESSAGES"],
      environment,
      createClient: () => ({ rpc }),
      log: vi.fn(),
    });

    expect(rpc).toHaveBeenCalledWith("run_direct_message_cleanup", {
      requested_batch_size: 100,
    });
    expect(result).toEqual({
      mode: "execute",
      auditId: 8,
      count: 1,
      messageIds: [9],
      status: "completed",
    });
  });

  it("fails before creating a client when service credentials are missing", async () => {
    const createClient = vi.fn();

    await expect(
      executeCleanupCommand({
        args: [],
        environment: {},
        createClient,
        log: vi.fn(),
      }),
    ).rejects.toThrow("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    expect(createClient).not.toHaveBeenCalled();
  });
});
