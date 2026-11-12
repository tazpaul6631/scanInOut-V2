import { exportCsvPaged, type ExportColumn } from '@/services/export'
import {
  countScans,
  deleteAllScanLogs,
  listScanLogsPage,
} from '@/services/repositories/scans'
import { formatDateTime } from '@/utils/format'
import type { ScanLog } from '@/types'

export const SCAN_ARCHIVE_THRESHOLD = 15

const EXPORT_PAGE_SIZE = 1000

const exportColumns: ExportColumn[] = [
  { key: 'index', header: '#', width: 5 },
  { key: 'location', header: 'Location', width: 16 },
  { key: 'barcode', header: 'Box', width: 28 },
  { key: 'datenow', header: 'DateNow', width: 22 },
  { key: 'userId', header: 'UserId', width: 18 },
  { key: 'method', header: 'Method', width: 12 },
]

let archiving = false

function mapExportRow(row: ScanLog, index: number) {
  return {
    index,
    location: row.location,
    barcode: row.value,
    datenow: formatDateTime(row.createdAt),
    userId: row.userCode?.trim() || row.userEmail?.trim() || '',
    method: row.kind === 'manual' ? 'Input' : 'Laser',
  }
}

export type ScanArchiveResult = {
  n: number
  filename: string
}

/**
 * If SQLite has >= SCAN_ARCHIVE_THRESHOLD rows: export full CSV, delete all, return result.
 * Concurrent callers get null while a run is in progress.
 */
export async function maybeArchiveScansIfFull(): Promise<ScanArchiveResult | null> {
  if (archiving) return null
  const total = await countScans()
  if (total < SCAN_ARCHIVE_THRESHOLD) return null

  archiving = true
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `scan-logs-auto-${stamp}.csv`
    let index = 0
    const n = await exportCsvPaged(
      filename,
      exportColumns,
      async (offset, limit) => {
        const rows = await listScanLogsPage({
          limit,
          offset,
          order: 'asc',
        })
        return rows.map((row) => {
          index += 1
          return mapExportRow(row, index)
        })
      },
      EXPORT_PAGE_SIZE,
    )
    await deleteAllScanLogs()
    return { n, filename }
  } finally {
    archiving = false
  }
}
