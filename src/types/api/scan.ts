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
