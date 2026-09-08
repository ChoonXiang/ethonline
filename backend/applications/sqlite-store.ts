import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Application, ApplicationStore, RegistrationResult } from "./types";

export class SqliteApplicationStore implements ApplicationStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path, { timeout: 5_000 });
    try {
      chmodSync(path, 0o600);
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS applications (
          application_id TEXT PRIMARY KEY NOT NULL,
          service_name TEXT UNIQUE NOT NULL,
          record_json TEXT NOT NULL
        ) STRICT;
      `);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  insertIfAbsent(application: Application): RegistrationResult {
    // Uniqueness is enforced in SQLite across API processes and retries.
    const result = this.database.prepare(`
      INSERT INTO applications (application_id, service_name, record_json)
      VALUES (?, ?, ?)
      ON CONFLICT(service_name) DO NOTHING
    `).run(application.applicationId, application.serviceName, JSON.stringify(application));
    const row = this.database.prepare("SELECT record_json FROM applications WHERE service_name = ?")
      .get(application.serviceName)!;
    return { created: result.changes === 1, application: this.decode(row) };
  }

  get(applicationId: string): Application | undefined {
    const row = this.database.prepare("SELECT record_json FROM applications WHERE application_id = ?").get(applicationId);
    return row ? this.decode(row) : undefined;
  }

  list(): Application[] {
    return this.database.prepare("SELECT record_json FROM applications ORDER BY rowid").all()
      .map((row) => this.decode(row));
  }

  close(): void {
    this.database.close();
  }

  private decode(row: Record<string, unknown>): Application {
    return JSON.parse(row.record_json as string) as Application;
  }
}
