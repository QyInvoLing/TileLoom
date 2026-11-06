import { TRANSPARENT_BACKGROUND, rgbToHex, type PixelArt, type SourceImage } from './pixelArt'

/** 每 blockWidth × blockHeight 个原图像素合成一个新像素；网格从 (offsetX, offsetY) 开始对齐。 */
export interface BlockSettings {
  blockWidth: number
  blockHeight: number
  offsetX: number
  offsetY: number
}

/** 网格在两个方向上的分界线，相邻两项之间就是一列或一行像素块。 */
export interface BlockGrid {
  columns: number[]
  rows: number[]
}

/** 取样结果，data 为逐块的 RGBA 数据，可直接写入 ImageData。 */
export interface SampledBlocks {
  columns: number
  rows: number
  data: Uint8ClampedArray
}

/** 超过这个瓷砖数量时预览会明显卡顿，因此拒绝应用。 */
export const MAX_TILE_COUNT = 65536

/** 长边不超过这个尺寸的图片默认按像素画处理（1 × 1）。 */
const PIXEL_ART_MAX_SIDE = 128
/** 较大的图片默认把长边划分成约这么多块。 */
const RECOMMENDED_LONG_SIDE_TILES = 64

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function getMaxBlockSize(source: SourceImage) {
  return Math.max(source.width, source.height)
}

export function normalizeBlockSettings(settings: BlockSettings, source: SourceImage): BlockSettings {
  const maxSize = getMaxBlockSize(source)
  const blockWidth = clampInteger(settings.blockWidth, 1, maxSize)
  const blockHeight = clampInteger(settings.blockHeight, 1, maxSize)

  return {
    blockWidth,
    blockHeight,
    offsetX: clampInteger(settings.offsetX, 0, Number.MAX_SAFE_INTEGER) % blockWidth,
    offsetY: clampInteger(settings.offsetY, 0, Number.MAX_SAFE_INTEGER) % blockHeight,
  }
}

export function getRecommendedBlockSettings(source: SourceImage): BlockSettings {
  const longSide = getMaxBlockSize(source)
  const size = longSide <= PIXEL_ART_MAX_SIDE ? 1 : Math.ceil(longSide / RECOMMENDED_LONG_SIDE_TILES)
  return { blockWidth: size, blockHeight: size, offsetX: 0, offsetY: 0 }
}

/**
 * 计算一个方向上的分界线。偏移不为 0 时，开头会有一段不足一整块的区域；
 * 末尾不能整除的部分同样单独成块，保证原图每个像素都被取样。
 */
export function getAxisBoundaries(length: number, size: number, offset: number) {
  const boundaries = [0]
  let next = offset > 0 ? offset : size
  while (next < length) {
    boundaries.push(next)
    next += size
  }
  boundaries.push(length)
  return boundaries
}

export function getBlockGrid(source: SourceImage, settings: BlockSettings): BlockGrid {
  const safeSettings = normalizeBlockSettings(settings, source)
  return {
    columns: getAxisBoundaries(source.width, safeSettings.blockWidth, safeSettings.offsetX),
    rows: getAxisBoundaries(source.height, safeSettings.blockHeight, safeSettings.offsetY),
  }
}

export function getTileCount(grid: BlockGrid) {
  return (grid.columns.length - 1) * (grid.rows.length - 1)
}

/** 返回 position 所在的块序号（boundaries[i] <= position < boundaries[i + 1]）。 */
export function getBlockIndex(boundaries: number[], position: number) {
  let low = 0
  let high = boundaries.length - 2
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (boundaries[middle] <= position) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return low
}

/** 每个像素块取区域内所有像素的平均色；透明像素先叠在暖白背景上再参与平均。 */
export function sampleBlocks(source: SourceImage, grid: BlockGrid): SampledBlocks {
  const { width } = source
  const data = source.imageData.data
  const columnCount = grid.columns.length - 1
  const rowCount = grid.rows.length - 1
  const background = TRANSPARENT_BACKGROUND

  const columnOfPixel = new Uint32Array(width)
  for (let column = 0; column < columnCount; column += 1) {
    columnOfPixel.fill(column, grid.columns[column], grid.columns[column + 1])
  }

  const sums = new Float64Array(columnCount * rowCount * 3)
  for (let row = 0; row < rowCount; row += 1) {
    const rowStart = row * columnCount
    for (let y = grid.rows[row]; y < grid.rows[row + 1]; y += 1) {
      let offset = y * width * 4
      for (let x = 0; x < width; x += 1, offset += 4) {
        const opacity = data[offset + 3] / 255
        const transparency = 1 - opacity
        const sumIndex = (rowStart + columnOfPixel[x]) * 3
        sums[sumIndex] += data[offset] * opacity + background.r * transparency
        sums[sumIndex + 1] += data[offset + 1] * opacity + background.g * transparency
        sums[sumIndex + 2] += data[offset + 2] * opacity + background.b * transparency
      }
    }
  }

  const output = new Uint8ClampedArray(columnCount * rowCount * 4)
  for (let row = 0; row < rowCount; row += 1) {
    const blockHeight = grid.rows[row + 1] - grid.rows[row]
    for (let column = 0; column < columnCount; column += 1) {
      const area = (grid.columns[column + 1] - grid.columns[column]) * blockHeight
      const block = row * columnCount + column
      output[block * 4] = Math.round(sums[block * 3] / area)
      output[block * 4 + 1] = Math.round(sums[block * 3 + 1] / area)
      output[block * 4 + 2] = Math.round(sums[block * 3 + 2] / area)
      output[block * 4 + 3] = 255
    }
  }

  return { columns: columnCount, rows: rowCount, data: output }
}

export function getBlockColor(blocks: SampledBlocks, column: number, row: number) {
  const offset = (row * blocks.columns + column) * 4
  return rgbToHex(blocks.data[offset], blocks.data[offset + 1], blocks.data[offset + 2])
}

export function blocksToPixelArt(blocks: SampledBlocks, name: string): PixelArt {
  const pixels = Array.from({ length: blocks.columns * blocks.rows }, (_, index) =>
    getBlockColor(blocks, index % blocks.columns, Math.floor(index / blocks.columns)),
  )

  return {
    id: `upload-${Date.now()}`,
    name,
    width: blocks.columns,
    height: blocks.rows,
    pixels,
  }
}
