import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "path";
import { fileURLToPath } from "url";
import type { FixtureDirs } from "./fixtures.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Runs the real server (src/index.ts under tsx) as a child process pointed at
 * fixture databases, and talks to it over stdio like an MCP client. Use it for
 * read tools only: UI tools would send real links to a running Logos.
 *
 * @param dirs - Fixture directories the server should read from.
 * @param extraEnv - Extra environment variables for the server process.
 * @returns A connected MCP client; close it when done.
 */
export async function startServer(
  dirs: FixtureDirs,
  extraEnv: Record<string, string> = {}
): Promise<Client> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, { LOGOS_DATA_DIR: dirs.dataDir, LOGOS_CATALOG_DIR: dirs.catalogDir }, extraEnv);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(PACKAGE_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(PACKAGE_ROOT, "src", "index.ts")],
    env,
    cwd: PACKAGE_ROOT,
  });
  const client = new Client({ name: "logos-mcp-tests", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/**
 * Call a tool and join its text content blocks.
 *
 * @param client - A client from {@link startServer}.
 * @param name - The tool name.
 * @param args - The tool arguments.
 * @returns The joined text and whether the call reported an error.
 */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return {
    text: content.map((c) => c.text ?? "").join("\n"),
    isError: result.isError === true,
  };
}
