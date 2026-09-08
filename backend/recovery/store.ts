import type { Incident } from "./types";

/** Storage contract only. A durable implementation is required before enabling recovery. */
export interface RecoveryStore {
  /**
   * Atomically consume the owner's current arming generation and insert revision 0.
   * Enforce unique incidentId and (applicationId, armingId), and one active incident
   * per application. Redelivery returns the existing incident; changed snapshots
   * for the same identity must be rejected. Never silently rearm an application.
   */
  openOnce(incident: Incident): Promise<{ created: boolean; incident: Incident }>;

  load(incidentId: string): Promise<Incident | undefined>;

  /**
   * Atomically commit revision expectedRevision + 1, including its journal entry.
   * Return false if the stored revision changed. Purchase intent and budget
   * reservation must share this transaction; recheck the application's armed/stop
   * state for new purchase and endpoint intents. Only the winning caller may send
   * the effect after commit. On restart, reconcile the persisted operation IDs.
   */
  compareAndSwap(incident: Incident, expectedRevision: number): Promise<boolean>;
}
