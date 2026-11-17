export interface ViewScanResult {
  id: string
  locationCode?: string | null
  boxCode?: string | null
  method?: string | null
  scanType?: string | null
  warehouse?: string | null
  scanAt?: string | null
  scanBy?: string | null
}

export interface ScanQueryResultRequest {
  locationCode?: string | null
  boxCode?: string | null
  method?: 'Input' | 'Laser' | null
  scanType?: string | null
  warehouse?: string | null
  scanBy?: string | null
  /** Local wall-clock `YYYY-MM-DD 00:00:00` */
  scanAtFrom?: string | null
  /** Local wall-clock `YYYY-MM-DD 23:59:59` */
  scanAtTo?: string | null
  outBoxBarCode?: string | null
  warehouseName?: string | null
  storageName?: string | null
  cutNo?: string | null
  smStyleCode?: string | null
  styleName?: string | null
  sizeName?: string | null
  boxNo?: string | null
  perCount?: string | null
  lastLeaveDateFrom?: string | null
  lastLeaveDateTo?: string | null
  isWarning?: boolean | null
  page?: number
  pageSize?: number
}

export interface ScanQueryResult {
  items?: ViewScanResult[] | null
  totalCount: number
  page: number
  pageSize: number
  totalPage?: number
  hasNextPage?: boolean
  hasPreviousPage?: boolean
}

export interface ViewScanServiceResult {
  id: string
  locationCode?: string | null
  boxCode?: string | null
  method?: string | null
  scanType?: string | null
  warehouse?: string | null
  scanAt?: string | null
  scanBy?: string | null
  buName?: string | null
  outBoxBarCode?: string | null
  warehouseName?: string | null
  storageName?: string | null
  cutNo?: string | null
  smStyleCode?: string | null
  styleName?: string | null
  sizeName?: string | null
  boxNo?: number | null
  perCount?: number | null
  lastLeaveDate?: string | null
  isWarning?: boolean | null
}

export interface ScanServiceQueryResult {
  items?: ViewScanServiceResult[] | null
  totalCount: number
  page: number
  pageSize: number
  totalPage?: number
  hasNextPage?: boolean
  hasPreviousPage?: boolean
}
