import { http } from '@/services/http'
import type { ApiResponse, ViewCategoryBase } from '@/types/api'

export async function queryWarehouseBaseList() {
  const { data } = await http.post<ApiResponse<ViewCategoryBase[]>>('/category/whc/getbaselist', {
    isActive: true,
  })
  return data
}

export async function queryScanTypeBaseList() {
  const { data } = await http.post<ApiResponse<ViewCategoryBase[]>>('/category/stc/getbaselist', {
    isActive: true,
  })
  return data
}
