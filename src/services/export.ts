import ExcelJS from 'exceljs'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import Papa from 'papaparse'
import { saveAs } from 'file-saver'
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export interface ExportColumn {
  key: string
  header: string
  /** Excel column width (characters). */
  width?: number
  /** Excel number format, e.g. `dd/mm/yyyy hh:mm:ss`. */
  numFmt?: string
}

async function saveNative(filename: string, data: string, encoding: Encoding = Encoding.UTF8) {
  await Filesystem.writeFile({
    path: `scanInOutV2/${filename}`,
    data,
    directory: Directory.Documents,
    encoding,
    recursive: true,
  })
  const uri = await Filesystem.getUri({
    path: `scanInOutV2/${filename}`,
    directory: Directory.Documents,
  })
  try {
    await Share.share({
      title: filename,
      url: uri.uri,
    })
  } catch {
    // user cancelled share
  }
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export async function exportCsv(
  filename: string,
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
) {
  const csv = Papa.unparse({
    fields: columns.map((c) => c.header),
    data: rows.map((row) => columns.map((c) => row[c.key] ?? '')),
  })
  if (Capacitor.isNativePlatform()) {
    await saveNative(filename, csv)
  } else {
    saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
  }
}

/**
 * Write CSV by fetching pages so large exports (100k+) never hold every row in RAM at once.
 * Returns total data rows written (excluding header).
 */
export async function exportCsvPaged(
  filename: string,
  columns: ExportColumn[],
  fetchPage: (offset: number, limit: number) => Promise<Record<string, unknown>[]>,
  pageSize = 1000,
): Promise<number> {
  const path = `scanInOutV2/${filename}`
  const header = `${columns.map((c) => csvEscape(c.header)).join(',')}\n`
  let offset = 0
  let total = 0
  const webChunks: string[] = [header]

  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({
      path,
      data: header,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    })
  }

  for (; ;) {
    const rows = await fetchPage(offset, pageSize)
    if (!rows.length) break
    const body =
      rows
        .map((row) => columns.map((c) => csvEscape(row[c.key])).join(','))
        .join('\n') + '\n'
    total += rows.length
    if (Capacitor.isNativePlatform()) {
      await Filesystem.appendFile({
        path,
        data: body,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      })
    } else {
      webChunks.push(body)
    }
    offset += rows.length
    if (rows.length < pageSize) break
  }

  if (Capacitor.isNativePlatform()) {
    const uri = await Filesystem.getUri({
      path,
      directory: Directory.Documents,
    })
    try {
      await Share.share({
        title: filename,
        url: uri.uri,
      })
    } catch {
      // user cancelled share
    }
  } else {
    saveAs(new Blob(webChunks, { type: 'text/csv;charset=utf-8' }), filename)
  }

  return total
}

async function writeXlsxFile(filename: string, wb: ExcelJS.Workbook): Promise<void> {
  const buf = await wb.xlsx.writeBuffer()
  if (Capacitor.isNativePlatform()) {
    const bytes = new Uint8Array(buf as ArrayBuffer)
    let binary = ''
    bytes.forEach((b) => {
      binary += String.fromCharCode(b)
    })
    await Filesystem.writeFile({
      path: `scanInOutV2/${filename}`,
      data: btoa(binary),
      directory: Directory.Documents,
      recursive: true,
    })
  } else {
    saveAs(
      new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename,
    )
  }
}

export async function exportXlsx(
  filename: string,
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 22,
  }))
  ws.addRows(rows)

  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: 'middle' }

  columns.forEach((c, index) => {
    if (!c.numFmt) return
    ws.getColumn(index + 1).numFmt = c.numFmt
  })

  // Enable Excel AutoFilter on the full data range (header + rows)
  const lastCol = columns.length
  const lastRow = Math.max(1, rows.length + 1)
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: lastRow, column: lastCol },
  }

  await writeXlsxFile(filename, wb)
}

export interface ScanWorkbookSummary {
  totalBoxes: number
  locationCount: number
  userCount: number
  byLocation: Array<{ key: string; count: number }>
  byUser: Array<{ key: string; count: number }>
}

/**
 * Excel with TongKet + ChiTiet. Detail rows are added page-by-page (no second full JS array).
 * Returns number of detail rows written.
 */
export async function exportScanWorkbookPaged(
  filename: string,
  detailColumns: ExportColumn[],
  summary: ScanWorkbookSummary,
  fetchPage: (offset: number, limit: number) => Promise<Record<string, unknown>[]>,
  pageSize = 1000,
): Promise<number> {
  const wb = new ExcelJS.Workbook()

  const tongKet = wb.addWorksheet('Total Summary')
  tongKet.getColumn(1).width = 12
  tongKet.getColumn(2).width = 10
  tongKet.addRow(['Metric', 'Value'])
  tongKet.getRow(1).font = { bold: true }
  tongKet.addRow(['Total boxes', summary.totalBoxes])
  tongKet.addRow(['Locations', summary.locationCount])
  tongKet.addRow(['Users', summary.userCount])

  tongKet.addRow([])
  tongKet.addRow(['By location', 'Boxes'])
  tongKet.getRow(tongKet.rowCount).font = { bold: true }
  for (const row of summary.byLocation) {
    tongKet.addRow([row.key, row.count])
  }

  tongKet.addRow([])
  tongKet.addRow(['By user', 'Boxes'])
  tongKet.getRow(tongKet.rowCount).font = { bold: true }
  for (const row of summary.byUser) {
    tongKet.addRow([row.key, row.count])
  }

  const chiTiet = wb.addWorksheet('Detail')
  chiTiet.columns = detailColumns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 15,
  }))
  chiTiet.getColumn(1).width = 7
  chiTiet.getColumn(2).width = 10
  chiTiet.getColumn(3).width = 20
  chiTiet.getColumn(5).width = 14
  chiTiet.getRow(1).font = { bold: true }
  chiTiet.getRow(1).alignment = { vertical: 'middle' }
  detailColumns.forEach((c, index) => {
    if (!c.numFmt) return
    chiTiet.getColumn(index + 1).numFmt = c.numFmt
  })

  let offset = 0
  let total = 0
  for (; ;) {
    const rows = await fetchPage(offset, pageSize)
    if (!rows.length) break
    for (const row of rows) {
      chiTiet.addRow(detailColumns.map((c) => row[c.key] ?? ''))
    }
    total += rows.length
    offset += rows.length
    if (rows.length < pageSize) break
  }

  const lastCol = detailColumns.length
  const lastRow = Math.max(1, total + 1)
  chiTiet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: lastRow, column: lastCol },
  }

  await writeXlsxFile(filename, wb)
  return total
}

export async function exportPdf(
  filename: string,
  title: string,
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text(title, 14, 16)
  autoTable(doc, {
    startY: 22,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => String(row[c.key] ?? ''))),
  })
  if (Capacitor.isNativePlatform()) {
    const data = doc.output('datauristring').split(',')[1]
    await Filesystem.writeFile({
      path: `scanInOutV2/${filename}`,
      data,
      directory: Directory.Documents,
      recursive: true,
    })
  } else {
    doc.save(filename)
  }
}
