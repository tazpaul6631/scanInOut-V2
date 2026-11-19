import dayjs from 'dayjs'
import type { ExportColumn } from '@/services/export'
import type { ViewScanServiceResult } from '@/types/api'

export const WEB_SCAN_SERVICE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'index', header: '#', width: 10 },
  { key: 'scanAt', header: '實盤日期\nActual Inventory Date\nNgày kiểm kê thực tế', width: 13 },
  { key: 'scanBy', header: '實盤人員ID\nInventory User ID\nMã ID nhân viên kiểm kê', width: 13 },
  { key: 'scanType', header: '實盤型態\nInventory Type\nLoại hình kiểm kê', width: 13 },
  { key: 'method', header: '實盤方式\nInventory Method\nPhương thức kiểm kê', width: 13 },
  { key: 'warehouse', header: '實盤位置(倉)\nActual Inventory Location (Warehouse)\nVị trí kiểm kê thực tế (Kho)', width: 15 },
  { key: 'locationCode', header: '實盤儲位\nActual Inventory Storage Location\nVị trí lưu trữ thực tế', width: 15 },
  { key: 'outBoxBarCode', header: '實盤外箱條碼標\nActual Carton Barcode Label\nNhãn mã vạch thùng carton thực tế', width: 18 },
  { key: 'boxState', header: '箱狀態\nBox State\nTrạng thái thùng', width: 15 },
  { key: 'warehouseName', header: 'ERP現在位置(倉)\nCurrent ERP Location (Warehouse)\nVị trí hiện tại trên ERP (Kho)', width: 15 },
  { key: 'storageName', header: 'ERP現在儲位\nCurrent ERP Storage Location\nVị trí lưu trữ hiện tại trên ERP', width: 15 },
  { key: 'cutNo', header: 'JHV number', width: 18 },
  { key: 'smStyleCode', header: '型體\nModel\nKiểu dáng', width: 25 },
  { key: 'styleName', header: 'JHV Art', width: 15 },
  { key: 'sizeName', header: '尺碼\nSize\nCỡ giày', width: 17, wrap: true },
  { key: 'boxNo', header: '箱號\nCarton Number\nSố thùng', width: 10 },
  { key: 'perCount', header: '雙數\nPairs\nSố đôi', width: 10 },
  { key: 'lastLeaveDate', header: 'Current CRD/CSD\nCRD/CSD hiện tại', width: 15 },
]

function formatExportDate(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = Date.parse(value)
  if (!parsed) return ''
  return dayjs(parsed).format('DD/MM/YYYY')
}

export function mapWebScanServiceExportRow(
  row: ViewScanServiceResult,
  index: number | string,
): Record<string, unknown> {
  return {
    index,
    scanAt: formatExportDate(row.scanAt),
    scanBy: row.scanBy?.trim() || '',
    scanType: row.scanType?.trim() || '',
    method:
      row.method === 'Input' ? 'KeyInput'
        : row.method === 'Laser' ? 'Scan'
          : row.method?.trim() || '',
    warehouse: row.warehouse?.trim() || '',
    locationCode: row.locationCode?.trim() || '',
    outBoxBarCode: row.outBoxBarCode?.trim() || '',
    warehouseName: row.warehouseName?.trim() || '',
    storageName: row.storageName?.trim() || '',
    boxState: row.boxState?.trim() || '',
    cutNo: row.cutNo?.trim() || '',
    smStyleCode: row.smStyleCode?.trim() || '',
    styleName: row.styleName?.trim() || '',
    sizeName: row.sizeName?.trim() || '',
    boxNo: row.boxNo ?? '',
    perCount: row.perCount ?? '',
    lastLeaveDate: formatExportDate(row.lastLeaveDate),
  }
}
