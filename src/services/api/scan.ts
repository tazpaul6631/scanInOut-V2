import { http } from '@/services/http'
import { useAuthStore } from '@/stores/auth'
import type {
  ApiResponse,
  ScanQueryResult,
  ScanQueryResultRequest,
  ScanServiceQueryResult,
} from '@/types/api'
import type { ScanLog } from '@/types'
import { toLocalIso } from '@/utils/format'

export interface ScanApiItem {
  status: number
  locationCode: string
  boxCode: string
  method: 'Input' | 'Laser'
  scanAt: string
  scanBy: string
  scanType: string
  warehouse: string
}

export function toScanApiItem(row: ScanLog, status = row.status ?? 0): ScanApiItem {
  const session = useAuthStore().session
  return {
    status,
    locationCode: row.location,
    boxCode: row.value,
    method: row.kind === 'manual' ? 'Input' : 'Laser',
    scanAt: toLocalIso(row.createdAt),
    scanBy: row.userCode?.trim() || row.userEmail?.trim() || '',
    scanType: session?.scanType ?? '',
    warehouse: session?.warehouse ?? '',
  }
}

export async function queryScanResult(params: ScanQueryResultRequest = {}) {
  const { data } = await http.post<ApiResponse<ScanQueryResult>>('/scan/src/queryresult', params)
  return data
}

export async function queryScanServiceResult(params: ScanQueryResultRequest = {}) {
  const { data } = await http.post<ApiResponse<ScanServiceQueryResult>>(
    '/scan/srvc/queryresult',
    params,
  )
  return data
}

const COMMAND_TIMEOUT_MS = 10_000

/** Online: single object via /scan/src/command. Sync batch: array via /sync/sc/syncsr. */
export async function commandScan(body: ScanApiItem, timeout = COMMAND_TIMEOUT_MS) {
  const { data } = await http.post<ApiResponse<unknown>>('/scan/src/command', body, { timeout })
  return data
}

export async function commandScans(body: ScanApiItem[]) {
  const { data } = await http.post<ApiResponse<unknown>>('/sync/sc/syncsr', body)
  return data
}
