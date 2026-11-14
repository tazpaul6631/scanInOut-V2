import dayjs from 'dayjs'
import type { ExportColumn } from '@/services/export'
import type { ViewScanServiceResult } from '@/types/api'

export const WEB_SCAN_SERVICE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'index', header: '#', width: 7 },
  { key: 'warehouse', header: 'Warehouse', width: 18 },
  { key: 'wareHouseName', header: 'Warehouse name', width: 22 },
  { key: 'locationCode', header: 'Location', width: 18 },
  { key: 'storageName', header: 'Storage', width: 18 },
  { key: 'boxCode', header: 'Box code', width: 22 },
  { key: 'outBoxBarCode', header: 'Out box barcode', width: 24 },
  { key: 'method', header: 'Method', width: 12 },
  { key: 'scanType', header: 'Scan type', width: 16 },
  { key: 'scanBy', header: 'Scan by', width: 16 },
  { key: 'scanAt', header: 'Scan at', width: 20 },
  { key: 'buName', header: 'BU', width: 14 },
  { key: 'cutNo', header: 'Cut no', width: 14 },
  { key: 'smStyleCode', header: 'Style code', width: 16 },
  { key: 'styleName', header: 'Style name', width: 20 },
  { key: 'sizeName', header: 'Size', width: 10 },
  { key: 'boxNo', header: 'Box no', width: 10 },
  { key: 'perCount', header: 'Per count', width: 10 },
  { key: 'lastLeaveDate', header: 'Last leave', width: 20 },
]

export function mapWebScanServiceExportRow(
  row: ViewScanServiceResult,
  index: number | string,
): Record<string, unknown> {
  return {
    index,
    warehouse: row.warehouse?.trim() || '',
    wareHouseName: row.wareHouseName?.trim() || '',
    locationCode: row.locationCode?.trim() || '',
    storageName: row.storageName?.trim() || '',
    boxCode: row.boxCode?.trim() || '',
    outBoxBarCode: row.outBoxBarCode?.trim() || '',
    method: row.method?.trim() || '',
    scanType: row.scanType?.trim() || '',
    scanBy: row.scanBy?.trim() || '',
    scanAt: row.scanAt ? dayjs(row.scanAt).format('DD/MM/YYYY HH:mm:ss') : '',
    buName: row.buName?.trim() || '',
    cutNo: row.cutNo?.trim() || '',
    smStyleCode: row.smStyleCode?.trim() || '',
    styleName: row.styleName?.trim() || '',
    sizeName: row.sizeName?.trim() || '',
    boxNo: row.boxNo ?? '',
    perCount: row.perCount ?? '',
    lastLeaveDate: row.lastLeaveDate
      ? dayjs(row.lastLeaveDate).format('DD/MM/YYYY HH:mm:ss')
      : '',
  }
}
