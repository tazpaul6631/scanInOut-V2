import { query, run, withTransaction } from '@/storage/database'
import type { ViewCategoryBase } from '@/types/api'

interface BoxStateRow {
  id: number
  code: string | null
  name: string | null
}

function mapRow(row: BoxStateRow): ViewCategoryBase {
  return {
    id: Number(row.id ?? 0),
    code: row.code,
    name: row.name,
  }
}

export async function listBoxStateBase(): Promise<ViewCategoryBase[]> {
  const rows = await query<BoxStateRow>(
    `SELECT id, code, name FROM box_state_base ORDER BY name COLLATE NOCASE ASC, code COLLATE NOCASE ASC`,
  )
  return rows.map(mapRow)
}

export async function replaceBoxStateBase(rows: ViewCategoryBase[]): Promise<void> {
  const next = (rows ?? []).filter((row) => row != null && Number.isFinite(Number(row.id)))
  await withTransaction(async () => {
    await run(`DELETE FROM box_state_base`)
    for (const row of next) {
      await run(`INSERT INTO box_state_base (id, code, name) VALUES (?, ?, ?)`, [
        Number(row.id),
        row.code?.trim() || null,
        row.name?.trim() || null,
      ])
    }
  })
}
