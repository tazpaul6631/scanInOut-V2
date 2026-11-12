import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { SCAN_EXPORT_COLUMNS, mapScanExportRow } from '@/services/scan-export-format'
import type { ScanLog } from '@/types'

/** Append-only CSV under Documents/scanInOutV2 — survives UI limits and delete-all. */
export const SCAN_LIVE_LOG_PATH = 'scanInOutV2/scan-live-log.csv'

const HEADER = `${SCAN_EXPORT_COLUMNS.map((c) => c.header).join(',')}\n`

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function lineFor(
  item: Pick<ScanLog, 'kind' | 'value' | 'location' | 'createdAt' | 'userCode' | 'userEmail'>,
): string {
  const row = mapScanExportRow(item, '')
  return `${SCAN_EXPORT_COLUMNS.map((c) => csvCell(row[c.key])).join(',')}\n`
}

async function ensureLiveLogFile(): Promise<void> {
  try {
    await Filesystem.stat({
      path: SCAN_LIVE_LOG_PATH,
      directory: Directory.Documents,
    })
  } catch {
    await Filesystem.writeFile({
      path: SCAN_LIVE_LOG_PATH,
      data: HEADER,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    })
  }
}

/** Best-effort true append; never throws to the scan flow. */
export async function appendScanLiveLog(
  item: Pick<ScanLog, 'kind' | 'value' | 'location' | 'createdAt' | 'userCode' | 'userEmail'>,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await ensureLiveLogFile()
    await Filesystem.appendFile({
      path: SCAN_LIVE_LOG_PATH,
      data: lineFor(item),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    })
  } catch {
    // ignore disk / permission errors
  }
}
