import { http } from '@/services/http'
import type {
  ApiResponse,
  StorageQueryResult,
  StorageQueryResultRequest,
  ViewCategoryBase,
  ViewWarehouseBase,
  WarehouseQueryResult,
  WarehouseQueryResultRequest,
} from '@/types/api'

export async function queryWarehouseBaseList() {
  const { data } = await http.post<ApiResponse<ViewWarehouseBase[]>>('/category/whc/getbaselist', {})
  return data
}

export async function queryWarehouseResult(params: WarehouseQueryResultRequest = {}) {
  const { data } = await http.post<ApiResponse<WarehouseQueryResult>>(
    '/category/whc/queryresult',
    params,
  )
  return data
}

export async function queryStorageResult(params: StorageQueryResultRequest = {}) {
  const { data } = await http.post<ApiResponse<StorageQueryResult>>(
    '/category/sc/queryresult',
    params,
  )
  return data
}

export async function queryScanTypeBaseList() {
  const { data } = await http.post<ApiResponse<ViewCategoryBase[]>>('/category/stc/getbaselist', {
    isActive: true,
  })
  return data
}

export async function queryBoxStateBaseList() {
  const { data } = await http.post<ApiResponse<ViewCategoryBase[]>>('/category/bsc/getbaselist', {
    isActive: true,
  })
  return data
}
