# Contrib plugins

Drop a TypeScript module here. The agent loads it at startup. **Do not change panel core** — the panel lists whatever `GET /plugins` / `list_plugins` returns.

Database plugins (`kind: "database"`) show up in **Databases → Create** after **Install**. **Browse** opens the native viewer. Implement `inspect`, `preview`, and optionally `query` so tables and rows load.

```ts
import type { AgentPlugin } from "../contract";

const example: AgentPlugin = {
  id: "exampledb",
  name: "ExampleDB",
  kind: "database",
  description: "Example engine on this node",
  capabilities: [
    { op: "health", label: "Health check" },
    { op: "install", label: "Install" },
    { op: "create", label: "Create database" },
    { op: "delete", label: "Delete database" },
    { op: "inspect", label: "Inspect schema" },
    { op: "preview", label: "Preview rows" },
    { op: "query", label: "Run query" },
  ],
  async handler(op, params, ctx) {
    if (op === "health") return { ok: true, installed: true, detail: "ready" };
    if (op === "inspect") {
      return {
        ok: true,
        data: {
          tables: [
            {
              schema: "public",
              name: String(params.dbName || "db"),
              kind: "table",
              approxRows: 0,
              columns: [
                {
                  name: "id",
                  dataType: "text",
                  udtName: "text",
                  nullable: false,
                  defaultValue: null,
                  ordinal: 1,
                  isPrimaryKey: true,
                },
              ],
            },
          ],
          pgVersion: "exampledb",
          indexes: [],
          relations: [],
          functions: [],
          triggers: [],
          enums: [],
        },
      };
    }
    if (op === "preview") {
      return {
        ok: true,
        data: {
          columns: ["id"],
          rows: [{ id: "1" }],
          limit: 100,
        },
      };
    }
    if (op === "query") {
      return {
        ok: true,
        data: { command: "SQL", columns: ["id"], rows: [{ id: "1" }] },
      };
    }
    throw new Error(`Not implemented: ${op}`);
  },
};

export default example;
```

Filename must end in `.ts`, `.js`, or `.mjs`. Restart the agent after adding a file.
