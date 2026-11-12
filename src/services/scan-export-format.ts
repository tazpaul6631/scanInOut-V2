import dayjs from 'dayjs'
import type { ExportColumn } from '@/services/export'
import { useAuthStore } from '@/stores/auth'
import type { ScanLog } from '@/types'

export const SCAN_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'index', header: '#', width: 6 },
  {
    key: 'scanDate',
    header: '實盤日期\nActual Inventory Date\nNgày kiểm kê thực tế',
    width: 22,
  },
  {
    key: 'userId',
    header: '實盤人員ID\nInventory User ID\nMã ID nhân viên kiểm kê',
    width: 22,
  },
  {
    key: 'scanType',
    header: '實盤型態\nInventory Type\nLoại hình kiểm kê',
    width: 22,
  },
  {
    key: 'method',
    header: '實盤方式\nInventory Method\nPhương thức kiểm kê',
    width: 22,
  },
  {
    key: 'warehouse',
    header: '實盤位置(含倉庫)\nActual Inventory Location (Warehouse)\nVị trí kiểm kê thực tế (Kho)',
    width: 28,
  },
  {
    key: 'location',
    header: '實盤儲位\nActual Inventory Storage Location\nVị trí lưu trữ thực tế',
    width: 24,
  },
  {
    key: 'barcode',
    header: '實盤外箱條碼標籤\nActual Carton Barcode Label\nNhãn mã vạch thùng carton thực tế',
    width: 28,
  },
]

export function mapScanExportRow(
  row: Pick<ScanLog, 'kind' | 'value' | 'location' | 'createdAt' | 'userCode' | 'userEmail'>,
  index: number | string,
): Record<string, unknown> {
  const session = useAuthStore().session
  return {
    index,
    scanDate: dayjs(row.createdAt).format('DD/MM/YYYY'),
    userId: row.userCode?.trim() || row.userEmail?.trim() || '',
    scanType: session?.scanType ?? '',
    method: row.kind === 'manual' ? 'Input' : 'Scan',
    warehouse: session?.warehouse ?? '',
    location: row.location,
    barcode: row.value,
  }
}
