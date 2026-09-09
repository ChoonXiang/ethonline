import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Application } from "../applications/types";
import { openSqliteDatabase } from "../storage/sqlite";
import { initialHealth, recordHealth, targetIdentity } from "./state";
import { HEALTH_INTERVAL_MS, HEALTH_TIMEOUT_MS, type ApplicationHealth, type HealthCheck, type ProbeClaim, type RecordedHealth } from "./types";

interface HealthRow {
  target_json: string;
  state_json: string;
  next_check_at: number;
  lease_id: string | null;
  lease_expires_at: number;
}

export class SqliteMonitoringStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = openSqliteDatabase(path);
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS application_health (
          application_id TEXT PRIMARY KEY NOT NULL,
          target_json TEXT NOT NULL,
          state_json TEXT NOT NULL,
          next_check_at INTEGER NOT NULL,
          lease_id TEXT,
          lease_expires_at INTEGER NOT NULL
        ) STRICT;
      `);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  get(application: Application): ApplicationHealth {
    const row = this.row(application.applicationId);
    return row?.target_json === targetIdentity(application) ? JSON.parse(row.state_json) : initialHealth(application);
  }

  claim(application: Application, now: number): ProbeClaim | undefined {
    return this.transaction(() => {
      const current = this.application(application.applicationId);
      const target = targetIdentity(application);
      if (!current || targetIdentity(current) !== target) return undefined;
      const row = this.row(application.applicationId);
      const sameTarget = row?.target_json === target;
      if (sameTarget && (row.lease_expires_at > now || row.next_check_at > now)) return undefined;
      const id = randomUUID();
      const state = sameTarget ? row.state_json : JSON.stringify(initialHealth(application));
      this.database.prepare(`
        INSERT INTO application_health VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(application_id) DO UPDATE SET
          target_json = excluded.target_json, state_json = excluded.state_json,
          next_check_at = excluded.next_check_at, lease_id = excluded.lease_id,
          lease_expires_at = excluded.lease_expires_at
      `).run(application.applicationId, target, state, now + HEALTH_INTERVAL_MS, id, now + HEALTH_TIMEOUT_MS + 5_000);
      return { id, applicationId: application.applicationId };
    });
  }

  record(claim: ProbeClaim, check: HealthCheck, now: number): RecordedHealth | undefined {
    return this.transaction(() => {
      const row = this.row(claim.applicationId);
      const application = this.application(claim.applicationId);
      if (!row || row.lease_id !== claim.id || row.lease_expires_at <= now ||
        !application || targetIdentity(application) !== row.target_json || check.reason === "cancelled" ||
        !Number.isSafeInteger(check.checkedAt) || check.checkedAt < row.next_check_at - HEALTH_INTERVAL_MS ||
        check.checkedAt > now) return undefined;
      const result = recordHealth(JSON.parse(row.state_json), check);
      this.database.prepare(`
        UPDATE application_health SET state_json = ?, lease_id = NULL, lease_expires_at = 0
        WHERE application_id = ?
      `).run(JSON.stringify(result.health), claim.applicationId);
      return result;
    });
  }

  release(claim: ProbeClaim): void {
    this.database.prepare(`
      UPDATE application_health SET lease_id = NULL, lease_expires_at = 0
      WHERE application_id = ? AND lease_id = ?
    `).run(claim.applicationId, claim.id);
  }

  close(): void {
    this.database.close();
  }

  private row(applicationId: string): HealthRow | undefined {
    return this.database.prepare("SELECT * FROM application_health WHERE application_id = ?").get(applicationId) as unknown as HealthRow | undefined;
  }

  private application(applicationId: string): Application | undefined {
    const row = this.database.prepare("SELECT record_json FROM applications WHERE application_id = ?").get(applicationId);
    return row ? JSON.parse(row.record_json as string) : undefined;
  }

  private transaction<T>(operation: () => T): T {
    // The short write transaction coordinates independent worker processes.
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
