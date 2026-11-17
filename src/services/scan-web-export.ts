import {
  exportScanWorkbookPaged,
  type ScanWorkbookSummary,
} from '@/services/export'
import {
  WEB_SCAN_EXPORT_COLUMNS,
  mapWebScanExportRow,
} from '@/services/scan-export-format-web'
import {
  WEB_SCAN_SERVICE_EXPORT_COLUMNS,
  mapWebScanServiceExportRow,
} from '@/services/scan-export-format-service'
import type { ViewScanResult, ViewScanServiceResult } from '@/types/api'

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

export type ScanQueryPage = {
  items: ViewScanResult[]
  totalCount: number
}

/** Stream /scan query pages into Excel (Detail first); mutates summary while fetching. */
export async function exportWebScanWorkbookFromQuery(
  filename: string,
  fetchPage: (page: number, pageSize: number) => Promise<ScanQueryPage>,
  onProgress?: (done: number, total: number) => void,
  pageSize = 200,
): Promise<number> {
  const locationCounts = new Map<string, number>()
  const userCounts = new Map<string, number>()
  const summary: ScanWorkbookSummary = {
    totalBoxes: 0,
    locationCount: 0,
    userCount: 0,
    byLocation: [],
    byUser: [],
  }

  const refreshSummary = () => {
    summary.locationCount = [...locationCounts.keys()].filter((key) => key !== '—').length
    summary.userCount = [...userCounts.keys()].filter((key) => key !== '—').length
    summary.byLocation = [...locationCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    summary.byUser = [...userCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  }

  let rowIndex = 0
  let knownTotal = 0

  return exportScanWorkbookPaged(
    filename,
    WEB_SCAN_EXPORT_COLUMNS,
    summary,
    async (offset, limit) => {
      const page = Math.floor(offset / limit) + 1
      const res = await fetchPage(page, limit)
      knownTotal = res.totalCount
      const items = res.items ?? []
      const mapped = items.map((row) => {
        rowIndex += 1
        const location = row.locationCode?.trim() || '—'
        const user = row.scanBy?.trim() || '—'
        locationCounts.set(location, (locationCounts.get(location) ?? 0) + 1)
        userCounts.set(user, (userCounts.get(user) ?? 0) + 1)
        return mapWebScanExportRow(row, rowIndex)
      })
      summary.totalBoxes = offset + mapped.length
      refreshSummary()
      return mapped
    },
    pageSize,
    undefined,
    (done) => onProgress?.(done, knownTotal),
  )
}

export function summarizeWebScanService(rows: ViewScanServiceResult[]) {
  return summarizeWebScans(
    rows.map((row) => ({
      id: row.id,
      locationCode: row.locationCode,
      scanBy: row.scanBy,
    })),
  )
}

const SERVICE_WARNING_DETAIL_KEYS = [
  'warehouse',
  'locationCode',
  'outBoxBarCode',
  'warehouseName',
  'storageName',
  'cutNo',
  'smStyleCode',
  'styleName',
  'sizeName',
  'boxNo',
  'perCount',
  'lastLeaveDate',
] as const

const WARN_ONLY_IF_VALUE = new Set(['warehouse', 'locationCode'])

const WARNING_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FFFEF3C7' },
}

function serviceWarningCols() {
  return SERVICE_WARNING_DETAIL_KEYS.map((key) => ({
    key,
    index: WEB_SCAN_SERVICE_EXPORT_COLUMNS.findIndex((col) => col.key === key),
  })).filter((col) => col.index >= 0)
}

function styleServiceWarningRow(
  excelRow: { getCell: (col: number) => { fill: unknown } },
  sourceRow: Record<string, unknown>,
  warningCols: Array<{ key: string; index: number }>,
) {
  if (!sourceRow.__isWarning) return
  for (const { key, index } of warningCols) {
    if (WARN_ONLY_IF_VALUE.has(key) && !String(sourceRow[key] ?? '').trim()) continue
    excelRow.getCell(index + 1).fill = WARNING_FILL
  }
}

/** Excel for /scan/srvc/queryresult rows. */
export async function exportWebScanServiceWorkbook(
  filename: string,
  rows: ViewScanServiceResult[],
  pageSize = 1000,
): Promise<number> {
  const mapped = rows.map((row, index) => ({
    ...mapWebScanServiceExportRow(row, index + 1),
    __isWarning: Boolean(row.isWarning),
  }))
  const summary = summarizeWebScanService(rows)
  const warningCols = serviceWarningCols()

  return exportScanWorkbookPaged(
    filename,
    WEB_SCAN_SERVICE_EXPORT_COLUMNS,
    summary,
    async (offset, limit) => mapped.slice(offset, offset + limit),
    pageSize,
    (excelRow, sourceRow) => styleServiceWarningRow(excelRow, sourceRow, warningCols),
  )
}

export type ScanServiceQueryPage = {
  items: ViewScanServiceResult[]
  totalCount: number
}

/** Stream API pages into Excel (Detail first); mutates summary while fetching. */
export async function exportWebScanServiceWorkbookFromQuery(
  filename: string,
  fetchPage: (page: number, pageSize: number) => Promise<ScanServiceQueryPage>,
  onProgress?: (done: number, total: number) => void,
  pageSize = 200,
): Promise<number> {
  const warningCols = serviceWarningCols()
  const locationCounts = new Map<string, number>()
  const userCounts = new Map<string, number>()
  const summary: ScanWorkbookSummary = {
    totalBoxes: 0,
    locationCount: 0,
    userCount: 0,
    byLocation: [],
    byUser: [],
  }

  const refreshSummary = () => {
    summary.locationCount = [...locationCounts.keys()].filter((key) => key !== '—').length
    summary.userCount = [...userCounts.keys()].filter((key) => key !== '—').length
    summary.byLocation = [...locationCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    summary.byUser = [...userCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  }

  let rowIndex = 0
  let knownTotal = 0

  return exportScanWorkbookPaged(
    filename,
    WEB_SCAN_SERVICE_EXPORT_COLUMNS,
    summary,
    async (offset, limit) => {
      const page = Math.floor(offset / limit) + 1
      const res = await fetchPage(page, limit)
      knownTotal = res.totalCount
      const items = res.items ?? []
      const mapped = items.map((row) => {
        rowIndex += 1
        const location = row.locationCode?.trim() || '—'
        const user = row.scanBy?.trim() || '—'
        locationCounts.set(location, (locationCounts.get(location) ?? 0) + 1)
        userCounts.set(user, (userCounts.get(user) ?? 0) + 1)
        return {
          ...mapWebScanServiceExportRow(row, rowIndex),
          __isWarning: Boolean(row.isWarning),
        }
      })
      summary.totalBoxes = offset + mapped.length
      refreshSummary()
      return mapped
    },
    pageSize,
    (excelRow, sourceRow) => styleServiceWarningRow(excelRow, sourceRow, warningCols),
    (done) => onProgress?.(done, knownTotal),
  )
}
