import type { PixelArt } from './pixelArt'

export interface TileConfig {
  tileSize: number
  borderColor: string
  borderWidth: number
  radius: number
  gap: number
  gapColor: string
}

export interface TileCell {
  key: string
  x: number
  y: number
  width: number
  height: number
  radius: number
  color: string
}

export const DEFAULT_TILE_CONFIG: TileConfig = {
  tileSize: 24,
  borderColor: '#F1EADD',
  borderWidth: 1,
  radius: 3,
  gap: 3,
  gapColor: '#163344',
}

const MIN_TILE_SIZE = 4
const MAX_TILE_SIZE = 96

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function normalizeHexColor(value: string, fallback: string) {
  const normalized = value.trim().toUpperCase()
  if (normalized === 'TRANSPARENT') {
    return 'transparent'
  }

  if (/^#[0-9A-F]{6}$/.test(normalized)) {
    return normalized
  }

  const shortMatch = normalized.match(/^#([0-9A-F]{3})$/)
  if (shortMatch) {
    return `#${shortMatch[1]
      .split('')
      .map((character) => `${character}${character}`)
      .join('')}`
  }

  const shortAlphaMatch = normalized.match(/^#([0-9A-F]{4})$/)
  if (shortAlphaMatch) {
    return `#${shortAlphaMatch[1]
      .split('')
      .map((character) => `${character}${character}`)
      .join('')}`
  }

  if (/^#[0-9A-F]{8}$/.test(normalized)) {
    return normalized
  }

  return fallback
}

export function isTransparentColor(value: string) {
  return value.trim().toLowerCase() === 'transparent'
}

export function toColorPickerValue(value: string, fallback = '#FFFFFF') {
  const normalized = normalizeHexColor(value, '')
  if (!normalized || isTransparentColor(normalized)) {
    return fallback
  }

  return normalized.length === 9 ? normalized.slice(0, 7) : normalized
}

export function sanitizeConfig(config: TileConfig): TileConfig {
  return {
    tileSize: clamp(config.tileSize, MIN_TILE_SIZE, MAX_TILE_SIZE),
    borderColor: normalizeHexColor(config.borderColor, DEFAULT_TILE_CONFIG.borderColor),
    borderWidth: clamp(config.borderWidth, 0, 24),
    radius: clamp(config.radius, 0, 48),
    gap: clamp(config.gap, 0, 48),
    gapColor: normalizeHexColor(config.gapColor, DEFAULT_TILE_CONFIG.gapColor),
  }
}

export function getRenderSize(art: PixelArt, config: TileConfig) {
  const safeConfig = sanitizeConfig(config)
  return {
    width: art.width * safeConfig.tileSize + (art.width + 1) * safeConfig.gap,
    height: art.height * safeConfig.tileSize + (art.height + 1) * safeConfig.gap,
  }
}

export function getTileCells(art: PixelArt, config: TileConfig): TileCell[] {
  const safeConfig = sanitizeConfig(config)
  const inset = Math.min(safeConfig.borderWidth / 2, safeConfig.tileSize / 2)
  const width = Math.max(0.5, safeConfig.tileSize - safeConfig.borderWidth)
  const radius = Math.min(safeConfig.radius, width / 2)

  return art.pixels.map((color, index) => {
    const column = index % art.width
    const row = Math.floor(index / art.width)
    return {
      key: `${row}-${column}`,
      x: safeConfig.gap + column * (safeConfig.tileSize + safeConfig.gap) + inset,
      y: safeConfig.gap + row * (safeConfig.tileSize + safeConfig.gap) + inset,
      width,
      height: width,
      radius,
      color: normalizeHexColor(color, '#000000'),
    }
  })
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function createSvgMarkup(art: PixelArt, config: TileConfig) {
  const safeConfig = sanitizeConfig(config)
  const size = getRenderSize(art, safeConfig)
  const cells = getTileCells(art, safeConfig)
    .map(
      (cell) =>
        `<rect x="${cell.x}" y="${cell.y}" width="${cell.width}" height="${cell.height}" rx="${cell.radius}" fill="${cell.color}" stroke="${safeConfig.borderColor}" stroke-width="${safeConfig.borderWidth}" stroke-linejoin="round"/>`,
    )
    .join('')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" shape-rendering="geometricPrecision">`,
    `<title>${escapeXml(art.name)}   Tileloom preview</title>`,
    `<rect width="${size.width}" height="${size.height}" fill="${safeConfig.gapColor}"/>`,
    cells,
    '</svg>',
  ].join('')
}

function addRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()

  if (safeRadius === 0) {
    context.rect(x, y, width, height)
    return
  }

  context.moveTo(x + safeRadius, y)
  context.arcTo(x + width, y, x + width, y + height, safeRadius)
  context.arcTo(x + width, y + height, x, y + height, safeRadius)
  context.arcTo(x, y + height, x, y, safeRadius)
  context.arcTo(x, y, x + width, y, safeRadius)
  context.closePath()
}

export function drawTilesToCanvas(canvas: HTMLCanvasElement, art: PixelArt, config: TileConfig) {
  const safeConfig = sanitizeConfig(config)
  const size = getRenderSize(art, safeConfig)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('浏览器无法创建 PNG 导出画布。')
  }

  canvas.width = size.width
  canvas.height = size.height
  context.fillStyle = safeConfig.gapColor
  context.fillRect(0, 0, size.width, size.height)

  getTileCells(art, safeConfig).forEach((cell) => {
    addRoundedRectPath(context, cell.x, cell.y, cell.width, cell.height, cell.radius)
    context.fillStyle = cell.color
    context.fill()

    if (safeConfig.borderWidth > 0) {
      context.strokeStyle = safeConfig.borderColor
      context.lineWidth = safeConfig.borderWidth
      context.stroke()
    }
  })
}
