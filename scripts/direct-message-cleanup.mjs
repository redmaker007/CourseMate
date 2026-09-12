import { pathToFileURL } from "node:url";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const CONFIRMATION = "DELETE_DIRECT_MESSAGES";

function readOption(argument, name) {
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : undefined;
}

export function parseCleanupArgs(args) {
  let mode = "preview";
  let batchSize = 100;
  let evaluationTime;
  let confirmation;

  for (const argument of args) {
    if (argument === "--execute") {
      mode = "execute";
      continue;
    }

    const requestedBatchSize = readOption(argument, "--batch-size");
    if (requestedBatchSize !== undefined) {
      batchSize = Number(requestedBatchSize);
      continue;
    }

    const requestedEvaluationTime = readOption(argument, "--as-of");
    if (requestedEvaluationTime !== undefined) {
      evaluationTime = requestedEvaluationTime;
      continue;
    }

    const requestedConfirmation = readOption(argument, "--confirm");
    if (requestedConfirmation !== undefined) {
      confirmation = requestedConfirmation;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("--batch-size must be an integer between 1 and 1000");
  }

  if (evaluationTime !== undefined && Number.isNaN(Date.parse(evaluationTime))) {
    throw new Error("--as-of must be a valid ISO-8601 timestamp");
  }

  if (mode === "execute" && confirmation !== CONFIRMATION) {
    throw new Error(
      `Execute mode requires --confirm=${CONFIRMATION}`,
    );
  }

  if (mode === "execute" && evaluationTime !== undefined) {
    throw new Error("--as-of can only be used in preview mode");
  }

  if (mode === "preview" && confirmation !== undefined) {
    throw new Error("--confirm can only be used with --execute");
  }

  return { mode, batchSize, evaluationTime };
}

function firstRow(data) {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error("Cleanup RPC returned an unexpected response");
  }

  return data[0];
}

export async function executeCleanupCommand({
  args,
  environment,
  createClient = createSupabaseClient,
  log = console.log,
}) {
  const options = parseCleanupArgs(args);
  const url = environment.SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
    );
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const rpcName =
    options.mode === "preview"
      ? "preview_direct_message_cleanup"
      : "run_direct_message_cleanup";
  const rpcArguments =
    options.mode === "preview"
      ? {
          evaluation_time: options.evaluationTime,
          requested_batch_size: options.batchSize,
        }
      : { requested_batch_size: options.batchSize };
  const { data, error } = await client.rpc(rpcName, rpcArguments);

  if (error) {
    throw new Error(`Cleanup RPC failed: ${error.message}`);
  }

  const row = firstRow(data);
  const result =
    options.mode === "preview"
      ? {
          mode: options.mode,
          auditId: row.audit_id,
          count: row.candidate_count,
          messageIds: row.message_ids,
          status: "completed",
        }
      : {
          mode: options.mode,
          auditId: row.audit_id,
          count: row.deleted_count,
          messageIds: row.message_ids,
          status: row.result_status,
        };

  log(JSON.stringify(result, null, 2));
  return result;
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  executeCleanupCommand({
    args: process.argv.slice(2),
    environment: process.env,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
