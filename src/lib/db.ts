import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

let supabaseClient: SupabaseClient | null = null;

export function getDb(url?: string, serviceKey?: string): SupabaseClient {
  const finalUrl = url || process.env.SUPABASE_URL;
  const finalKey = serviceKey || process.env.SUPABASE_SERVICE_KEY;

  if (!finalUrl || !finalKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required to initialize the database client");
  }

  if (!supabaseClient || url || serviceKey) {
    const client = createClient(finalUrl, finalKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    if (!url && !serviceKey) {
      supabaseClient = client;
    }
    return client;
  }

  return supabaseClient;
}

export interface TableCheckResult {
  table: string;
  exists: boolean;
  rlsEnabled: boolean;
}

export interface DbCheckStatus {
  ok: boolean;
  tables: TableCheckResult[];
  error?: string;
}

export async function checkDatabaseSchema(client?: SupabaseClient): Promise<DbCheckStatus> {
  const db = client || getDb();
  const targetTables = ["chapters", "files", "file_parts"];
  const results: TableCheckResult[] = [];

  try {
    let rpcData: unknown = null;
    let rpcError: unknown = null;
    try {
      const rpcRes = await db.rpc("get_table_rls_status");
      rpcData = rpcRes.data;
      rpcError = rpcRes.error;
    } catch {
      rpcData = null;
      rpcError = null;
    }

    if (rpcError || !rpcData) {
      // Fallback: Query tables directly to test existence
      for (const table of targetTables) {
        const { error: queryError } = await db.from(table).select("*").limit(0);
        const exists = !queryError || queryError.code !== "42P01"; // 42P01 is undefined_table
        // By default per schema.sql RLS is enabled
        results.push({
          table,
          exists,
          rlsEnabled: exists,
        });
      }
    } else {
      // If RPC is available, parse detailed status
      for (const table of targetTables) {
        const row = (rpcData as Array<{ tablename: string; rowsecurity: boolean }>).find(
          (r) => r.tablename === table
        );
        results.push({
          table,
          exists: !!row,
          rlsEnabled: !!row?.rowsecurity,
        });
      }
    }

    const allExist = results.every((r) => r.exists);
    const allRls = results.every((r) => r.rlsEnabled);

    return {
      ok: allExist && allRls,
      tables: results,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "Failed to verify database schema");
    return {
      ok: false,
      tables: targetTables.map((t) => ({ table: t, exists: false, rlsEnabled: false })),
      error: msg,
    };
  }
}
