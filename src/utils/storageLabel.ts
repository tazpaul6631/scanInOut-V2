/** Zebra ZT231-300dpi: 12 dots/mm. Use 8 for 203 dpi. */
export const DPMM = 12

export interface StorageLabelItem {
  warehouseName: string
  storageName: string
}

const mm = (v: number) => Math.round(v * DPMM)

const LABEL_W = mm(85)
const LABEL_H = mm(102)
const MARGIN_X = mm(3)
const MARGIN_Y = mm(1.5)
const AREA_W = mm(79)
const AREA_H = mm(99)
const BOTTOM = MARGIN_Y + AREA_H

const QR_MAG = 10 // ZPL ^BQ max magnification

function qrModules(text: string) {
  return text.length <= 14 ? 21 : text.length <= 26 ? 25 : 29
}

/** Font 0 size so string fits width and does not exceed maxH. */
function fitFont(text: string, maxW: number, maxH: number) {
  const safe = text.trim() || ' '
  const perChar = Math.floor((maxW * 0.97) / safe.length)
  const h = Math.max(8, Math.min(maxH, Math.round(perChar * 1.4)))
  return { h, w: Math.max(6, Math.round(h * 0.7)) }
}

/** Escape ZPL field data specials. */
function escapeFd(text: string) {
  return text.replaceAll('^', '').replaceAll('~', '').replaceAll('\\', '')
}

function centeredText(y: number, text: string, h: number, w: number) {
  return `^FO${MARGIN_X},${y}^FB${AREA_W},1,0,C,0^A0N,${h},${w}^FD${escapeFd(text)}^FS`
}

export function buildStorageZpl(item: StorageLabelItem): string {
  const qrText = item.storageName.trim()
  const warehouseName = item.warehouseName.trim() || ' '

  const qrSize = qrModules(qrText || ' ') * QR_MAG
  const qrX = MARGIN_X + Math.round((AREA_W - qrSize) / 2)
  const qrY = MARGIN_Y + mm(4)

  const y1 = qrY + qrSize + mm(6)
  const f1 = fitFont(warehouseName, AREA_W, mm(18))

  const y2 = y1 + f1.h + mm(3)
  const f2 = fitFont(qrText || ' ', AREA_W, Math.max(8, BOTTOM - y2))

  return [
    '^XA',
    '^CI28',
    '^MNY',
    `^PW${LABEL_W}`,
    `^LL${LABEL_H}`,
    '^LH0,0',
    `^FO${qrX},${qrY}^BQN,2,${QR_MAG},M^FDMA,${escapeFd(qrText)}^FS`,
    centeredText(y1, warehouseName, f1.h, f1.w),
    centeredText(y2, qrText || ' ', f2.h, f2.w),
    '^XZ',
  ].join('\n')
}

export function buildStorageZplBatch(items: StorageLabelItem[]): string {
  return items.map(buildStorageZpl).join('\n')
}
