import { http } from '@/services/http'
import type { ApiResponse } from '@/types/api'
import type { ScanLog } from '@/types'

export interface ScanApiItem {
  locationNumber: string
  boxNumber: string
  method: 'Input' | 'Laser'
  scanAt: string
  scanBy: string
}

export function toScanApiItem(row: ScanLog): ScanApiItem {
  return {
    locationNumber: row.location,
    boxNumber: row.value,
    method: row.kind === 'manual' ? 'Input' : 'Laser',
    scanAt: new Date(row.createdAt).toISOString(),
    scanBy: row.userCode?.trim() || row.userEmail?.trim() || '',
  }
}

export async function createScan(body: ScanApiItem) {
  const { data } = await http.post<ApiResponse<unknown>>('/scan/src/create', body)
  return data
}

export async function syncScans(body: ScanApiItem[]) {
  const { data } = await http.post<ApiResponse<unknown>>('/sync/sc/syncsr', body)
  return data
}
