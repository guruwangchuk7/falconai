import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./pool";

export async function migrate(): Promise<void> {
  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await getPool().query(sql);
}
