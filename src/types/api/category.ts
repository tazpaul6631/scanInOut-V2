export interface ViewCategoryBase {
  id: number
  code?: string | null
  name?: string | null
}

export interface ViewWarehouseBase {
  id: number
  warehouseId?: number | null
  warehouseCode?: string | null
  warehouseName?: string | null
}

export interface ViewWarehouseResult {
  id: number
  factoryId?: number | null
  factoryCode?: string | null
  factoryName?: string | null
  warehouseId?: number | null
  warehouseCode?: string | null
  warehouseName?: string | null
}

export interface WarehouseQueryResultRequest {
  factoryCode?: string | null
  factoryName?: string | null
  warehouseCode?: string | null
  warehouseName?: string | null
  page?: number
  pageSize?: number
}

export interface WarehouseQueryResult {
  items?: ViewWarehouseResult[] | null
  totalCount: number
  page: number
  pageSize: number
  totalPage?: number
  hasNextPage?: boolean
  hasPreviousPage?: boolean
}

export interface ViewStorageResult {
  id: number
  factoryId?: number | null
  warehouseId?: number | null
  warehouseCode?: string | null
  warehouseName?: string | null
  storageId?: number | null
  storageName?: string | null
}

export interface StorageQueryResultRequest {
  warehouseCode?: string | null
  warehouseName?: string | null
  storageName?: string | null
  page?: number
  pageSize?: number
}

export interface StorageQueryResult {
  items?: ViewStorageResult[] | null
  totalCount: number
  page: number
  pageSize: number
  totalPage?: number
  hasNextPage?: boolean
  hasPreviousPage?: boolean
}
