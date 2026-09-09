import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openSqliteDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  try {
    chmodSync(path, 0o600);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
