import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

async function getConnection(context: ToolContext) {
  const dbConfig = context.settings.database.mysql;
  if (!dbConfig) {
    return null;
  }
  const mysql = await import("mysql2/promise");
  return mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectTimeout: 10000,
  });
}

// --- mysql_query ---

const mysqlQuery: ToolDefinition = {
  name: "mysql_query",
  category: "database",
  group: "mysql",
  title: "MySQL Query",
  description:
    "Execute SQL queries against a configured MySQL database. Supports parameterized queries and read-only mode. Configure the connection in mcpy settings.",
  inputSchema: {
    query: z.string().describe("SQL query to execute"),
    params: z
      .array(z.unknown())
      .optional()
      .describe("Query parameters for parameterized queries"),
    readonly: z
      .boolean()
      .default(true)
      .describe("Execute in read-only mode (default: true)"),
    row_limit: z
      .number()
      .default(100)
      .describe("Maximum rows to return (default: 100)"),
  },
  requiredSettings: ["database.mysql"],
  async handler(params, context) {
    const { query, params: queryParams, readonly, row_limit } = params as {
      query: string;
      params?: unknown[];
      readonly: boolean;
      row_limit: number;
    };

    let connection;
    try {
      connection = await getConnection(context);
      if (!connection) {
        return errorResult("MySQL connection not configured. Set it in mcpy settings.");
      }

      if (readonly) {
        await connection.execute("SET SESSION TRANSACTION READ ONLY");
        await connection.beginTransaction();
      }

      const [rows, fields] = await connection.execute(query, queryParams || []);

      if (readonly) {
        await connection.rollback();
      }

      if (!Array.isArray(rows)) {
        const result = rows as {
          affectedRows?: number;
          insertId?: number;
          changedRows?: number;
        };
        return textResult(
          JSON.stringify(
            {
              affectedRows: result.affectedRows,
              insertId: result.insertId,
              changedRows: result.changedRows,
            },
            null,
            2
          )
        );
      }

      const limited = rows.slice(0, row_limit);
      const totalRows = rows.length;

      const lines = [
        `Rows: ${limited.length}${totalRows > row_limit ? ` (truncated from ${totalRows})` : ""}`,
      ];

      if (fields && Array.isArray(fields)) {
        const colNames = fields.map((f: { name: string }) => f.name);
        lines.push(`Columns: ${colNames.join(", ")}`);
      }

      lines.push("---");
      lines.push(JSON.stringify(limited, null, 2));

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `MySQL error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (connection) {
        try { await connection.end(); } catch { /* ignore */ }
      }
    }
  },
};

// --- mysql_list_tables ---

const mysqlListTables: ToolDefinition = {
  name: "mysql_list_tables",
  category: "database",
  group: "mysql",
  title: "MySQL List Tables",
  description:
    "List all tables in the configured MySQL database with row counts and engine info.",
  inputSchema: {},
  requiredSettings: ["database.mysql"],
  async handler(_params, context) {
    let connection;
    try {
      connection = await getConnection(context);
      if (!connection) {
        return errorResult("MySQL connection not configured. Set it in mcpy settings.");
      }

      const dbName = context.settings.database.mysql!.database;
      const [rows] = await connection.execute(
        `SELECT TABLE_NAME, TABLE_ROWS, ENGINE, TABLE_COMMENT
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [dbName]
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        return textResult("No tables found.");
      }

      const lines = [`Tables in ${dbName} (${rows.length})`, "---"];
      for (const row of rows as { TABLE_NAME: string; TABLE_ROWS: number; ENGINE: string; TABLE_COMMENT: string }[]) {
        const comment = row.TABLE_COMMENT ? ` -- ${row.TABLE_COMMENT}` : "";
        lines.push(`${row.TABLE_NAME}  (~${row.TABLE_ROWS} rows, ${row.ENGINE})${comment}`);
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `MySQL error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (connection) {
        try { await connection.end(); } catch { /* ignore */ }
      }
    }
  },
};

// --- mysql_describe_table ---

const mysqlDescribeTable: ToolDefinition = {
  name: "mysql_describe_table",
  category: "database",
  group: "mysql",
  title: "MySQL Describe Table",
  description:
    "Show column definitions, indexes, and foreign keys for a MySQL table.",
  inputSchema: {
    table: z.string().describe("Table name to describe"),
  },
  requiredSettings: ["database.mysql"],
  async handler(params, context) {
    const { table } = params as { table: string };

    let connection;
    try {
      connection = await getConnection(context);
      if (!connection) {
        return errorResult("MySQL connection not configured. Set it in mcpy settings.");
      }

      // Columns
      const [cols] = await connection.execute(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [context.settings.database.mysql!.database, table]
      );

      if (!Array.isArray(cols) || cols.length === 0) {
        return errorResult(`Table '${table}' not found.`);
      }

      const lines = [`Table: ${table}`, "---", "Columns:"];
      for (const col of cols as { COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_KEY: string; COLUMN_DEFAULT: string | null; EXTRA: string }[]) {
        const nullable = col.IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
        const key = col.COLUMN_KEY ? ` [${col.COLUMN_KEY}]` : "";
        const def = col.COLUMN_DEFAULT !== null ? ` default=${col.COLUMN_DEFAULT}` : "";
        const extra = col.EXTRA ? ` ${col.EXTRA}` : "";
        lines.push(`  ${col.COLUMN_NAME}  ${col.COLUMN_TYPE}  ${nullable}${key}${def}${extra}`);
      }

      // Indexes
      const [indexes] = await connection.execute(
        `SHOW INDEX FROM \`${table}\``
      );
      if (Array.isArray(indexes) && indexes.length > 0) {
        const grouped = new Map<string, string[]>();
        for (const idx of indexes as { Key_name: string; Column_name: string; Non_unique: number }[]) {
          if (!grouped.has(idx.Key_name)) grouped.set(idx.Key_name, []);
          grouped.get(idx.Key_name)!.push(idx.Column_name);
        }
        lines.push("", "Indexes:");
        for (const [name, columns] of grouped) {
          const unique = (indexes as { Key_name: string; Non_unique: number }[]).find(i => i.Key_name === name)?.Non_unique === 0 ? " UNIQUE" : "";
          lines.push(`  ${name}${unique}: (${columns.join(", ")})`);
        }
      }

      // Foreign keys
      const [fks] = await connection.execute(
        `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [context.settings.database.mysql!.database, table]
      );
      if (Array.isArray(fks) && fks.length > 0) {
        lines.push("", "Foreign Keys:");
        for (const fk of fks as { CONSTRAINT_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string }[]) {
          lines.push(`  ${fk.CONSTRAINT_NAME}: ${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}(${fk.REFERENCED_COLUMN_NAME})`);
        }
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `MySQL error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (connection) {
        try { await connection.end(); } catch { /* ignore */ }
      }
    }
  },
};

export { mysqlQuery, mysqlListTables, mysqlDescribeTable };
