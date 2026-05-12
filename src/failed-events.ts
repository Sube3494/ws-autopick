import { AppDatabase } from "./db.js";
import { FailedEventFilters, FailedEventRecord, DeliveryEvent } from "./types.js";

export class FailedEventStore {
  private retryIntervalMs: number;

  constructor(
    private readonly database: AppDatabase,
    retryIntervalMs: number,
  ) {
    this.retryIntervalMs = retryIntervalMs;
  }

  setRetryIntervalMs(retryIntervalMs: number) {
    this.retryIntervalMs = retryIntervalMs;
  }

  async ensure() {
    return;
  }

  async add(event: DeliveryEvent, lastError: string) {
    return this.database.addFailedEvent(event, this.retryIntervalMs, lastError);
  }

  async listReady(now = new Date()) {
    return this.database.listReadyFailedEvents(now);
  }

  async count() {
    return this.database.countFailedEvents();
  }

  async listAll(limit = 100) {
    return this.database.listFailedEvents(limit);
  }

  async listFiltered(filters: FailedEventFilters = {}) {
    return this.database.listFailedEventsFiltered(filters);
  }

  async markSucceeded(id: string) {
    this.database.markFailedEventSucceeded(id);
  }

  async reschedule(record: FailedEventRecord, error: string) {
    this.database.rescheduleFailedEvent(record, this.retryIntervalMs, error);
  }
}
