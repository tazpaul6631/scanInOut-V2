import dayjs from 'dayjs'
import type { ExportColumn } from '@/services/export'
import type { ViewScanResult } from '@/types/api'

/** Web-only columns (independent of mobile SCAN_EXPORT_COLUMNS). */
export const WEB_SCAN_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'index', header: '#', width: 7 },
  {
    key: 'scanDate',
    header: '實盤日期\nActual Inventory Date\nNgày kiểm kê thực tế',
    width: 25,
  },
  {
    key: 'userId',
    header: '實盤人員ID\nInventory User ID\nMã ID nhân viên kiểm kê',
    width: 28,
  },
  {
    key: 'scanType',
    header: '實盤型態\nInventory Type\nLoại hình kiểm kê',
    width: 25,
  },
  {
    key: 'method',
    header: '實盤方式\nInventory Method\nPhương thức kiểm kê',
    width: 28,
  },
  {
    key: 'warehouse',
    header: '實盤位置(含倉庫)\nActual Inventory Location (Warehouse)\nVị trí kiểm kê thực tế (Kho)',
    width: 40,
  },
  {
    key: 'location',
    header: '實盤儲位\nActual Inventory Storage Location\nVị trí lưu trữ thực tế',
    width: 35,
  },
  {
    key: 'barcode',
    header: '實盤外箱條碼標籤\nActual Carton Barcode Label\nNhãn mã vạch thùng carton thực tế',
    width: 38,
  },
  {
    key: 'boxState',
    header: '箱狀態\nBox State\nTrạng thái thùng',
    width: 15,
  },
]

export function mapWebScanExportRow(
  row: ViewScanResult,
  index: number | string,
): Record<string, unknown> {
  return {
    index,
    scanDate: row.scanAt ? dayjs(row.scanAt).format('DD/MM/YYYY') : '',
    userId: row.scanBy?.trim() || '',
    scanType: row.scanType?.trim() || '',
    method:
      row.method === 'Input' ? 'KeyInput'
        : row.method === 'Laser' ? 'Scan'
          : row.method?.trim() || '',
    warehouse: row.warehouse?.trim() || '',
    location: row.locationCode?.trim() || '',
    barcode: row.boxCode?.trim() || '',
    boxState: row.boxState?.trim() || '',
  }
}
