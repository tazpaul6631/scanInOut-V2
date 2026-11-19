import { query, run } from '@/storage/database'
import { appendScanLiveLog } from '@/services/scan-live-log'
import type { ScanDirection, ScanKind, ScanLog } from '@/types'
import { createId, now } from '@/utils/id'

/** Active rows only (hide delete tombstones waiting for sync). */
const NOT_DELETED = 'COALESCE(status, 0) != -1'

interface ScanRow {
  id: string
  kind: ScanKind
  value: string
  format: string | null
  direction: ScanDirection | null
  location: string | null
  user_code: string | null
  user_email: string | null
  created_at: number
  synced: number | null
  status: number | null
  box_state: string | null
}

function mapScan(row: ScanRow): ScanLog {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    format: row.format,
    direction: row.direction === 'out' ? 'out' : 'in',
    location: row.location?.trim() ?? '',
    userCode: row.user_code,
    userEmail: row.user_email,
    createdAt: row.created_at,
    status: Number(row.status ?? 0),
    synced: Number(row.synced ?? 0) === 1,
    boxState: row.box_state?.trim() ?? '',
  }
}

export async function addScanLog(input: {
  kind: ScanKind
  value: string
  format?: string | null
  direction?: ScanDirection
  location?: string
  userCode?: string | null
  userEmail?: string | null
  boxState?: string | null
}): Promise<ScanLog> {
  const item: ScanLog = {
    id: createId(),
    kind: input.kind,
    value: input.value.trim(),
    format: input.format ?? null,
    direction: input.direction ?? 'in',
    location: (input.location ?? '').trim(),
    userCode: input.userCode?.trim() || null,
    userEmail: input.userEmail?.trim() || null,
    createdAt: now(),
    status: 0,
    synced: false,
    boxState: input.boxState?.trim() || '',
  }
  await run(
    `INSERT INTO scan_logs (id, kind, value, format, direction, location, user_code, user_email, created_at, synced, status, box_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.kind,
      item.value,
      item.format,
      item.direction,
      item.location,
      item.userCode,
      item.userEmail,
      item.createdAt,
      0,
      0,
      item.boxState,
    ],
  )
  void appendScanLiveLog(item)
  return item
}

export interface ScanLogFilter {
  code?: string
  location?: string
  /** Inclusive local-day start (epoch ms). */
  dateFrom?: number
  /** Inclusive local-day end (epoch ms). */
  dateTo?: number
}

export interface ScanLogPageOptions extends ScanLogFilter {
  limit: number
  offset: number
  /** History UI uses oldest→newest (`asc`). Default `asc`. */
  order?: 'asc' | 'desc'
}

function buildScanFilter(filter: ScanLogFilter = {}): { where: string; params: Array<string | number | null> } {
  const clauses: string[] = [NOT_DELETED]
  const params: Array<string | number | null> = []
  const code = filter.code?.trim()
  const location = filter.location?.trim()
  if (code) {
    clauses.push('value LIKE ?')
    params.push(`%${code}%`)
  }
  if (location) {
    clauses.push('location LIKE ?')
    params.push(`%${location}%`)
  }
  if (filter.dateFrom != null && Number.isFinite(filter.dateFrom)) {
    clauses.push('created_at >= ?')
    params.push(filter.dateFrom)
  }
  if (filter.dateTo != null && Number.isFinite(filter.dateTo)) {
    clauses.push('created_at <= ?')
    params.push(filter.dateTo)
  }
  return {
    where: `WHERE ${clauses.join(' AND ')}`,
    params,
  }
}

/** Omit `limit` (or pass ≤ 0) to load every scan row. Prefer paged APIs for large sets. */
export async function listScanLogs(limit?: number): Promise<ScanLog[]> {
  if (limit != null && limit > 0) {
    const rows = await query<ScanRow>(
      `SELECT * FROM scan_logs WHERE ${NOT_DELETED} ORDER BY created_at DESC LIMIT ?`,
      [limit],
    )
    return rows.map(mapScan)
  }
  const rows = await query<ScanRow>(
    `SELECT * FROM scan_logs WHERE ${NOT_DELETED} ORDER BY created_at DESC`,
  )
  return rows.map(mapScan)
}

export async function countScans(): Promise<number> {
  const rows = await query<{ c: number }>(
    `SELECT COUNT(*) as c FROM scan_logs WHERE ${NOT_DELETED}`,
  )
  return Number(rows[0]?.c ?? 0)
}

export async function countUnsyncedScans(): Promise<number> {
  const rows = await query<{ c: number }>(
    'SELECT COUNT(*) as c FROM scan_logs WHERE COALESCE(synced, 0) = 0',
  )
  return Number(rows[0]?.c ?? 0)
}

export async function listUnsyncedScansPage(limit: number, offset = 0): Promise<ScanLog[]> {
  const safeLimit = Math.max(0, Math.floor(limit))
  const safeOffset = Math.max(0, Math.floor(offset))
  if (!safeLimit) return []
  const rows = await query<ScanRow>(
    `SELECT * FROM scan_logs
     WHERE COALESCE(synced, 0) = 0
     ORDER BY created_at ASC
     LIMIT ? OFFSET ?`,
    [safeLimit, safeOffset],
  )
  return rows.map(mapScan)
}

export async function markScansSynced(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (!unique.length) return
  const placeholders = unique.map(() => '?').join(', ')
  await run(`UPDATE scan_logs SET synced = 1 WHERE id IN (${placeholders})`, unique)
}

/** Soft-delete for offline: status=-1, re-queue sync. */
export async function markScanDeleted(id: string): Promise<void> {
  await run(`UPDATE scan_logs SET status = -1, synced = 0 WHERE id = ?`, [id])
}

export async function updateScanBoxState(id: string, boxState: string): Promise<void> {
  await run(`UPDATE scan_logs SET box_state = ?, synced = 0 WHERE id = ?`, [
    boxState.trim(),
    id,
  ])
}

/**
 * After a successful command sync batch: hard-delete tombstones, mark active rows synced.
 */
export async function finalizeSyncedScans(rows: ScanLog[]): Promise<void> {
  const deleteIds = rows.filter((row) => row.status === -1).map((row) => row.id)
  const keepIds = rows.filter((row) => row.status !== -1).map((row) => row.id)
  await markScansSynced(keepIds)
  if (!deleteIds.length) return
  const placeholders = deleteIds.map(() => '?').join(', ')
  await run(`DELETE FROM scan_logs WHERE id IN (${placeholders})`, deleteIds)
}

export async function countScansFiltered(filter: ScanLogFilter = {}): Promise<number> {
  const { where, params } = buildScanFilter(filter)
  const rows = await query<{ c: number }>(`SELECT COUNT(*) as c FROM scan_logs ${where}`, params)
  return Number(rows[0]?.c ?? 0)
}

export async function listScanLogsPage(opts: ScanLogPageOptions): Promise<ScanLog[]> {
  const limit = Math.max(0, Math.floor(opts.limit))
  const offset = Math.max(0, Math.floor(opts.offset))
  if (!limit) return []
  const order = opts.order === 'desc' ? 'DESC' : 'ASC'
  const { where, params } = buildScanFilter(opts)
  const rows = await query<ScanRow>(
    `SELECT * FROM scan_logs ${where} ORDER BY created_at ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  return rows.map(mapScan)
}

export async function countScansByLocation(location: string): Promise<number> {
  const loc = location.trim()
  if (!loc) return 0
  const rows = await query<{ c: number }>(
    `SELECT COUNT(*) as c FROM scan_logs WHERE location = ? AND ${NOT_DELETED}`,
    [loc],
  )
  return Number(rows[0]?.c ?? 0)
}

/** Newest first. Pass `limit` to cap UI lists on large shelves. */
export async function listScanLogsByLocation(location: string, limit?: number): Promise<ScanLog[]> {
  const loc = location.trim()
  if (!loc) return []
  if (limit != null && limit > 0) {
    const rows = await query<ScanRow>(
      `SELECT * FROM scan_logs WHERE location = ? AND ${NOT_DELETED} ORDER BY created_at DESC LIMIT ?`,
      [loc, limit],
    )
    return rows.map(mapScan)
  }
  const rows = await query<ScanRow>(
    `SELECT * FROM scan_logs WHERE location = ? AND ${NOT_DELETED} ORDER BY created_at DESC`,
    [loc],
  )
  return rows.map(mapScan)
}

export async function deleteScanLog(id: string): Promise<void> {
  await run(`DELETE FROM scan_logs WHERE id = ?`, [id])
}

export async function deleteAllScanLogs(): Promise<void> {
  await run(`DELETE FROM scan_logs`)
}

/** Box already saved (any location). Dedup is by value only; ignores delete tombstones. */
export async function findScanByValue(value: string): Promise<ScanLog | null> {
  const code = value.trim()
  if (!code) return null
  const rows = await query<ScanRow>(
    `SELECT * FROM scan_logs WHERE value = ? AND ${NOT_DELETED} ORDER BY created_at DESC LIMIT 1`,
    [code],
  )
  const row = rows[0]
  return row ? mapScan(row) : null
}

export async function existsScanLog(value: string, _direction?: ScanDirection): Promise<boolean> {
  return Boolean(await findScanByValue(value))
}

export interface ScanSummaryBucket {
  key: string
  count: number
}

export interface ScanSummary {
  totalBoxes: number
  locationCount: number
  userCount: number
  byLocation: ScanSummaryBucket[]
  byUser: ScanSummaryBucket[]
}

function userKeySql(): string {
  return `COALESCE(NULLIF(TRIM(COALESCE(user_code, '')), ''), NULLIF(TRIM(COALESCE(user_email, '')), ''), '')`
}

/** SQL aggregates for Excel TongKet — no full-table JS scan. */
export async function summarizeScanLogs(): Promise<ScanSummary> {
  const [totalRows, locationCountRows, userCountRows, byLocationRows, byUserRows] = await Promise.all([
    query<{ c: number }>(`SELECT COUNT(*) as c FROM scan_logs WHERE ${NOT_DELETED}`),
    query<{ c: number }>(
      `SELECT COUNT(*) as c FROM (
         SELECT DISTINCT TRIM(location) AS loc FROM scan_logs
         WHERE ${NOT_DELETED} AND TRIM(COALESCE(location, '')) != ''
       )`,
    ),
    query<{ c: number }>(
      `SELECT COUNT(*) as c FROM (
         SELECT DISTINCT ${userKeySql()} AS uid FROM scan_logs
         WHERE ${NOT_DELETED} AND ${userKeySql()} != ''
       )`,
    ),
    query<{ key: string; c: number }>(
      `SELECT TRIM(location) AS key, COUNT(*) AS c
       FROM scan_logs
       WHERE ${NOT_DELETED}
       GROUP BY TRIM(location)
       ORDER BY c DESC, key ASC`,
    ),
    query<{ key: string; c: number }>(
      `SELECT ${userKeySql()} AS key, COUNT(*) AS c
       FROM scan_logs
       WHERE ${NOT_DELETED}
       GROUP BY ${userKeySql()}
       ORDER BY c DESC, key ASC`,
    ),
  ])

  return {
    totalBoxes: Number(totalRows[0]?.c ?? 0),
    locationCount: Number(locationCountRows[0]?.c ?? 0),
    userCount: Number(userCountRows[0]?.c ?? 0),
    byLocation: byLocationRows.map((row) => ({
      key: row.key?.trim() || '—',
      count: Number(row.c ?? 0),
    })),
    byUser: byUserRows.map((row) => ({
      key: row.key?.trim() || '—',
      count: Number(row.c ?? 0),
    })),
  }
}
