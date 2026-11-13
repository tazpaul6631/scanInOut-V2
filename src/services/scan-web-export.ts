import {
  exportScanWorkbookPaged,
  type ScanWorkbookSummary,
} from '@/services/export'
import {
  WEB_SCAN_EXPORT_COLUMNS,
  mapWebScanExportRow,
} from '@/services/scan-export-format-web'
import type { ViewScanResult } from '@/types/api'

function countBy(values: string[]): Array<{ key: string; count: number }> {
  const map = new Map<string, number>()
  for (const value of values) {
    const key = value || '—'
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function summarizeWebScans(rows: ViewScanResult[]): ScanWorkbookSummary {
  const locations = rows.map((row) => row.locationCode?.trim() || '')
  const users = rows.map((row) => row.scanBy?.trim() || '')
  const uniqueLocations = new Set(locations.filter(Boolean))
  const uniqueUsers = new Set(users.filter(Boolean))
  return {
    totalBoxes: rows.length,
    locationCount: uniqueLocations.size,
    userCount: uniqueUsers.size,
    byLocation: countBy(locations),
    byUser: countBy(users),
  }
}

/** Excel TongKet + ChiTiet for web API rows (separate from mobile SQLite export). */
export async function exportWebScanWorkbook(
  filename: string,
  rows: ViewScanResult[],
  pageSize = 1000,
): Promise<number> {
  const mapped = rows.map((row, index) => mapWebScanExportRow(row, index + 1))
  const summary = summarizeWebScans(rows)
  return exportScanWorkbookPaged(
    filename,
    WEB_SCAN_EXPORT_COLUMNS,
    summary,
    async (offset, limit) => mapped.slice(offset, offset + limit),
    pageSize,
  )
}
