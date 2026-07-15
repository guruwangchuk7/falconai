import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./pool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await getPool().query(sql);
}
