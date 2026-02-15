import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

async function getClient(context: ToolContext) {
  const dbConfig = context.settings.database.postgres;
  if (!dbConfig) {
    return null;
  }
  const pg = await import("pg");
  const Client = pg.default?.Client || pg.Client;
  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  await client.connect();
  return client;
}

// --- postgres_query ---

const postgresQuery: ToolDefinition = {
  name: "postgres_query",
  category: "database",
  group: "postgres",
  title: "PostgreSQL Query",
  description:
    "Execute SQL queries against a configured PostgreSQL database. Supports parameterized queries and read-only mode. Configure the connection in mcpy settings.",
  inputSchema: {
    query: z.string().describe("SQL query to execute"),
    params: z
      .array(z.unknown())
      .optional()
      .describe("Query parameters ($1, $2, etc.)"),
    readonly: z
      .boolean()
      .default(true)
      .describe("Execute in read-only mode (default: true)"),
    row_limit: z
      .number()
      .default(100)
      .describe("Maximum rows to return (default: 100)"),
  },
  requiredSettings: ["database.postgres"],
  async handler(params, context) {
    const { query, params: queryParams, readonly, row_limit } = params as {
      query: string;
      params?: unknown[];
      readonly: boolean;
      row_limit: number;
    };

    let client;
    try {
      client = await getClient(context);
      if (!client) {
        return errorResult("PostgreSQL connection not configured. Set it in mcpy settings.");
      }

      if (readonly) {
        await client.query("BEGIN");
        await client.query("SET TRANSACTION READ ONLY");
      }

      const result = await client.query(query, queryParams || []);

      if (readonly) {
        await client.query("ROLLBACK");
      }

      if (!result.rows || result.rows.length === 0) {
        if (result.command && result.command !== "SELECT") {
          return textResult(
            JSON.stringify(
              { command: result.command, rowCount: result.rowCount },
              null,
              2
            )
          );
        }
        return textResult("Query returned no rows.");
      }

      const limited = result.rows.slice(0, row_limit);
      const totalRows = result.rows.length;

      const lines = [
        `Rows: ${limited.length}${totalRows > row_limit ? ` (truncated from ${totalRows})` : ""}`,
      ];

      if (result.fields) {
        const colNames = result.fields.map((f: { name: string }) => f.name);
        lines.push(`Columns: ${colNames.join(", ")}`);
      }

      lines.push("---");
      lines.push(JSON.stringify(limited, null, 2));

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `PostgreSQL error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (client) {
        try { await client.end(); } catch { /* ignore */ }
      }
    }
  },
};

// --- postgres_list_tables ---

const postgresListTables: ToolDefinition = {
  name: "postgres_list_tables",
  category: "database",
  group: "postgres",
  title: "PostgreSQL List Tables",
  description:
    "List all tables in the configured PostgreSQL database with row count estimates and descriptions.",
  inputSchema: {
    schema: z
      .string()
      .default("public")
      .describe("Schema to list tables from (default: public)"),
  },
  requiredSettings: ["database.postgres"],
  async handler(params, context) {
    const { schema = "public" } = params as { schema?: string };

    let client;
    try {
      client = await getClient(context);
      if (!client) {
        return errorResult("PostgreSQL connection not configured. Set it in mcpy settings.");
      }

      const result = await client.query(
        `SELECT c.relname AS table_name,
                c.reltuples::bigint AS row_estimate,
                obj_description(c.oid) AS comment
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r'
         ORDER BY c.relname`,
        [schema]
      );

      if (!result.rows || result.rows.length === 0) {
        return textResult(`No tables found in schema '${schema}'.`);
      }

      const lines = [`Tables in ${schema} (${result.rows.length})`, "---"];
      for (const row of result.rows) {
        const comment = row.comment ? ` -- ${row.comment}` : "";
        lines.push(`${row.table_name}  (~${row.row_estimate} rows)${comment}`);
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `PostgreSQL error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (client) {
        try { await client.end(); } catch { /* ignore */ }
      }
    }
  },
};

// --- postgres_describe_table ---

const postgresDescribeTable: ToolDefinition = {
  name: "postgres_describe_table",
  category: "database",
  group: "postgres",
  title: "PostgreSQL Describe Table",
  description:
    "Show column definitions, indexes, and foreign keys for a PostgreSQL table.",
  inputSchema: {
    table: z.string().describe("Table name to describe"),
    schema: z
      .string()
      .default("public")
      .describe("Schema name (default: public)"),
  },
  requiredSettings: ["database.postgres"],
  async handler(params, context) {
    const { table, schema = "public" } = params as { table: string; schema?: string };

    let client;
    try {
      client = await getClient(context);
      if (!client) {
        return errorResult("PostgreSQL connection not configured. Set it in mcpy settings.");
      }

      // Columns
      const cols = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default,
                character_maximum_length, numeric_precision
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table]
      );

      if (!cols.rows || cols.rows.length === 0) {
        return errorResult(`Table '${schema}.${table}' not found.`);
      }

      const lines = [`Table: ${schema}.${table}`, "---", "Columns:"];
      for (const col of cols.rows) {
        const nullable = col.is_nullable === "YES" ? "NULL" : "NOT NULL";
        let type = col.data_type;
        if (col.character_maximum_length) type += `(${col.character_maximum_length})`;
        const def = col.column_default ? ` default=${col.column_default}` : "";
        lines.push(`  ${col.column_name}  ${type}  ${nullable}${def}`);
      }

      // Indexes
      const indexes = await client.query(
        `SELECT i.relname AS index_name,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                array_agg(a.attname ORDER BY k.n) AS columns
         FROM pg_index ix
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
         WHERE n.nspname = $1 AND t.relname = $2
         GROUP BY i.relname, ix.indisunique, ix.indisprimary
         ORDER BY i.relname`,
        [schema, table]
      );

      if (indexes.rows && indexes.rows.length > 0) {
        lines.push("", "Indexes:");
        for (const idx of indexes.rows) {
          const tag = idx.is_primary ? " PRIMARY" : idx.is_unique ? " UNIQUE" : "";
          lines.push(`  ${idx.index_name}${tag}: (${idx.columns.join(", ")})`);
        }
      }

      // Foreign keys
      const fks = await client.query(
        `SELECT tc.constraint_name,
                kcu.column_name,
                ccu.table_name AS foreign_table,
                ccu.column_name AS foreign_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      );

      if (fks.rows && fks.rows.length > 0) {
        lines.push("", "Foreign Keys:");
        for (const fk of fks.rows) {
          lines.push(`  ${fk.constraint_name}: ${fk.column_name} -> ${fk.foreign_table}(${fk.foreign_column})`);
        }
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `PostgreSQL error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (client) {
        try { await client.end(); } catch { /* ignore */ }
      }
    }
  },
};

export { postgresQuery, postgresListTables, postgresDescribeTable };
