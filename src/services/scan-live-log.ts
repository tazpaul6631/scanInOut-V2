import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { formatDateTime } from '@/utils/format'
import type { ScanLog } from '@/types'

/** Append-only CSV under Documents/scanInOutV2 — survives UI limits and delete-all. */
export const SCAN_LIVE_LOG_PATH = 'scanInOutV2/scan-live-log.csv'

const HEADER = 'Location,Box,DateNow,UserId\n'

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function userIdFor(item: Pick<ScanLog, 'userCode' | 'userEmail'>): string {
  return item.userCode?.trim() || item.userEmail?.trim() || ''
}

function lineFor(
  item: Pick<ScanLog, 'value' | 'location' | 'createdAt' | 'userCode' | 'userEmail'>,
): string {
  return `${csvCell(item.location || '')},${csvCell(item.value)},${formatDateTime(item.createdAt)},${csvCell(userIdFor(item))}\n`
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
  item: Pick<ScanLog, 'value' | 'location' | 'createdAt' | 'userCode' | 'userEmail'>,
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
