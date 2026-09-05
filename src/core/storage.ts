/** IndexedDB persistence for reports and media blobs. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BugReport, MediaItem } from './types';
import { clearAllRewind } from './rewindStore';

export const DB_NAME = 'bugcapture';
export const DB_VERSION = 1;

export interface StoredBlob {
  id: string;
  reportId?: string;
  blob: Blob;
  createdAt: number;
}

interface BugCaptureDB extends DBSchema {
  reports: {
    key: string;
    value: BugReport;
    indexes: { createdAt: number };
  };
  blobs: {
    key: string;
    value: StoredBlob;
    indexes: { reportId: string };
  };
}

let dbPromise: Promise<IDBPDatabase<BugCaptureDB>> | undefined;

export function getDb(): Promise<IDBPDatabase<BugCaptureDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BugCaptureDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('reports')) {
          const reports = db.createObjectStore('reports', { keyPath: 'id' });
          reports.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          const blobs = db.createObjectStore('blobs', { keyPath: 'id' });
          blobs.createIndex('reportId', 'reportId');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveReport(report: BugReport): Promise<void> {
  const db = await getDb();
  await db.put('reports', report);
}

export async function getReport(id: string): Promise<BugReport | undefined> {
  const db = await getDb();
  return db.get('reports', id);
}

/** Newest reports first. */
export async function listReports(): Promise<BugReport[]> {
  const db = await getDb();
  const reports = await db.getAllFromIndex('reports', 'createdAt');
  return reports.reverse();
}

export async function deleteReport(id: string): Promise<void> {
  const db = await getDb();
  const blobKeys = await db.getAllKeysFromIndex('blobs', 'reportId', id);
  const tx = db.transaction(['reports', 'blobs'], 'readwrite');
  await Promise.all([
    tx.objectStore('reports').delete(id),
    ...blobKeys.map((key) => tx.objectStore('blobs').delete(key)),
    tx.done,
  ]);
}

export async function putBlob(id: string, blob: Blob, reportId?: string): Promise<void> {
  const db = await getDb();
  const record: StoredBlob = { id, blob, createdAt: Date.now() };
  if (reportId) record.reportId = reportId;
  await db.put('blobs', record);
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const db = await getDb();
  return (await db.get('blobs', id))?.blob;
}

/** Attach previously orphaned blobs (written before the report existed). */
export async function assignBlobs(mediaIds: readonly string[], reportId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('blobs', 'readwrite');
  for (const id of mediaIds) {
    const record = await tx.store.get(id);
    if (record) await tx.store.put({ ...record, reportId });
  }
  await tx.done;
}

export async function getReportMedia(
  report: BugReport,
): Promise<Array<MediaItem & { blob: Blob }>> {
  const items: Array<MediaItem & { blob: Blob }> = [];
  for (const media of report.media) {
    const blob = await getBlob(media.id);
    if (blob) items.push({ ...media, blob });
  }
  return items;
}

export interface StorageUsage {
  usageBytes: number;
  quotaBytes: number;
  percent: number;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usageBytes: 0, quotaBytes: 0, percent: 0 };
  }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return {
    usageBytes: usage,
    quotaBytes: quota,
    percent: quota > 0 ? Math.min(100, (usage / quota) * 100) : 0,
  };
}

/** Delete reports older than `retentionDays`. Returns the number removed. */
export async function pruneOldReports(retentionDays: number): Promise<number> {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const reports = await listReports();
  let removed = 0;
  for (const report of reports) {
    if (report.createdAt < cutoff) {
      await deleteReport(report.id);
      removed += 1;
    }
  }
  return removed;
}

/** Remove blobs that are not referenced by any report. */
export async function pruneOrphanBlobs(): Promise<number> {
  const db = await getDb();
  const reports = await db.getAll('reports');
  const referenced = new Set(reports.flatMap((report) => report.media.map((item) => item.id)));
  const blobs = await db.getAll('blobs');
  const cutoff = Date.now() - 60 * 60 * 1000;
  let removed = 0;
  for (const record of blobs) {
    if (!referenced.has(record.id) && record.createdAt < cutoff) {
      await db.delete('blobs', record.id);
      removed += 1;
    }
  }
  return removed;
}

/** Delete every stored report and blob. Settings are handled separately. */
export async function deleteAllData(): Promise<number> {
  const db = await getDb();
  const count = await db.count('reports');
  await db.clear('reports');
  await db.clear('blobs');
  // The Rewind buffer lives outside IndexedDB and must go with the rest.
  await clearAllRewind();
  return count;
}
