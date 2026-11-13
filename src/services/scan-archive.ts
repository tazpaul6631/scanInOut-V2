import {
  exportCsvPaged,
  exportScanWorkbookPaged,
} from '@/services/export'
import { SCAN_EXPORT_COLUMNS, mapScanExportRow } from '@/services/scan-export-format'
import { commandScans, toScanApiItem } from '@/services/api/scan'
import {
  countScans,
  deleteAllScanLogs,
  finalizeSyncedScans,
  listScanLogsPage,
  listUnsyncedScansPage,
  summarizeScanLogs,
} from '@/services/repositories/scans'
import { toLocalFileStamp } from '@/utils/format'

export const SCAN_ARCHIVE_THRESHOLD = 30000

const EXPORT_PAGE_SIZE = 1000
const SYNC_CHUNK = 500

let archiving = false

export type ScanArchiveNeedsOnline = {
  kind: 'needsOnline'
  total: number
}

export type ScanArchiveDone = {
  kind: 'archived'
  n: number
  csvFilename: string
  xlsxFilename: string
}

export type ScanArchiveResult = ScanArchiveNeedsOnline | ScanArchiveDone

async function syncAllUnsynced(): Promise<void> {
  for (; ;) {
    const rows = await listUnsyncedScansPage(SYNC_CHUNK, 0)
    if (!rows.length) break
    await commandScans(rows.map((row) => toScanApiItem(row, row.status)))
    await finalizeSyncedScans(rows)
  }
}

/**
 * If SQLite has >= SCAN_ARCHIVE_THRESHOLD rows:
 * - offline → needsOnline (no delete)
 * - online → sync all unsynced (incl. latest), export CSV+XLSX, then delete
 * Concurrent callers get null while a run is in progress.
 */
export async function maybeArchiveScansIfFull(
  online: boolean,
): Promise<ScanArchiveResult | null> {
  if (archiving) return null
  const total = await countScans()
  if (total < SCAN_ARCHIVE_THRESHOLD) return null
  if (!online) return { kind: 'needsOnline', total }

  archiving = true
  try {
    await syncAllUnsynced()

    const stamp = toLocalFileStamp()
    const csvFilename = `scan-logs-auto-${stamp}.csv`
    const xlsxFilename = `scan-logs-auto-${stamp}.xlsx`
    const summary = await summarizeScanLogs()

    let csvIndex = 0
    const csvN = await exportCsvPaged(
      csvFilename,
      SCAN_EXPORT_COLUMNS,
      async (offset, limit) => {
        const rows = await listScanLogsPage({ limit, offset, order: 'asc' })
        return rows.map((row) => {
          csvIndex += 1
          return mapScanExportRow(row, csvIndex)
        })
      },
      EXPORT_PAGE_SIZE,
    )

    let xlsxIndex = 0
    const xlsxN = await exportScanWorkbookPaged(
      xlsxFilename,
      SCAN_EXPORT_COLUMNS,
      summary,
      async (offset, limit) => {
        const rows = await listScanLogsPage({ limit, offset, order: 'asc' })
        return rows.map((row) => {
          xlsxIndex += 1
          return mapScanExportRow(row, xlsxIndex)
        })
      },
      EXPORT_PAGE_SIZE,
    )

    if (csvN !== xlsxN) {
      throw new Error(`Archive row mismatch: CSV=${csvN}, XLSX=${xlsxN}`)
    }

    await deleteAllScanLogs()
    return { kind: 'archived', n: csvN, csvFilename, xlsxFilename }
  } finally {
    archiving = false
  }
}
