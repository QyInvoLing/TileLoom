<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  MAX_TILE_COUNT,
  blocksToPixelArt,
  getBlockColor,
  getBlockGrid,
  getBlockIndex,
  getMaxBlockSize,
  getRecommendedBlockSettings,
  getTileCount,
  normalizeBlockSettings,
  sampleBlocks,
  type BlockSettings,
  type SampledBlocks,
} from '../lib/imageBlocks'
import type { PixelArt, SourceImage } from '../lib/pixelArt'

type Axis = 'x' | 'y'

interface PixelPoint {
  x: number
  y: number
}

interface PixelRect extends PixelPoint {
  width: number
  height: number
}

interface DragState {
  pointerId: number
  start: PixelPoint
  current: PixelPoint
  startClientX: number
  startClientY: number
  moved: boolean
}

const props = defineProps<{
  source: SourceImage
  initialSettings?: BlockSettings | null
}>()

const emit = defineEmits<{
  apply: [art: PixelArt, settings: BlockSettings]
  cancel: []
}>()

/** 滑块只覆盖常用范围，更大的值可以直接输入。 */
const SLIDER_MAX = 256
/** 网格线在屏幕上的间距小于这个值时会糊成一片，此时隐藏网格线。 */
const MIN_GRID_LINE_SPACING = 4
/** 指针移动超过这个距离（屏幕像素）才算拖拽，避免误触。 */
const DRAG_THRESHOLD = 4

const dialogRef = ref<HTMLDialogElement | null>(null)
const frameRef = ref<HTMLDivElement | null>(null)
const sourceCanvasRef = ref<HTMLCanvasElement | null>(null)
const resultCanvasRef = ref<HTMLCanvasElement | null>(null)
const applyButtonRef = ref<HTMLButtonElement | null>(null)

const recommendedSettings = computed(() => getRecommendedBlockSettings(props.source))
const initialSettings = normalizeBlockSettings(props.initialSettings ?? recommendedSettings.value, props.source)
const settings = reactive<BlockSettings>({ ...initialSettings })
const lockSquare = ref(initialSettings.blockWidth === initialSettings.blockHeight)
const displayScale = ref(0)
const hoverPoint = ref<PixelPoint | null>(null)
const dragState = ref<DragState | null>(null)

const maxBlockSize = computed(() => getMaxBlockSize(props.source))
const sliderMax = computed(() => Math.min(maxBlockSize.value, SLIDER_MAX))
const safeSettings = computed(() => normalizeBlockSettings(settings, props.source))
const grid = computed(() => getBlockGrid(props.source, safeSettings.value))
const columnCount = computed(() => grid.value.columns.length - 1)
const rowCount = computed(() => grid.value.rows.length - 1)
const tileCount = computed(() => getTileCount(grid.value))
const isOverLimit = computed(() => tileCount.value > MAX_TILE_COUNT)
const sampledBlocks = computed<SampledBlocks | null>(() =>
  isOverLimit.value ? null : sampleBlocks(props.source, grid.value),
)
const isRecommended = computed(() => {
  const current = safeSettings.value
  const recommended = recommendedSettings.value
  return (
    current.blockWidth === recommended.blockWidth &&
    current.blockHeight === recommended.blockHeight &&
    current.offsetX === recommended.offsetX &&
    current.offsetY === recommended.offsetY
  )
})

const imageRatio = computed(() => props.source.width / props.source.height)
const frameStyle = computed(() => ({ '--ratio': imageRatio.value }))
const resultFrameStyle = computed(() => ({ '--ratio': columnCount.value / rowCount.value }))
const isUpscaled = computed(() => displayScale.value >= 1)
const showGridLines = computed(
  () =>
    displayScale.value > 0 &&
    Math.min(safeSettings.value.blockWidth, safeSettings.value.blockHeight) * displayScale.value >=
      MIN_GRID_LINE_SPACING,
)
const gridPath = computed(() => {
  const { columns, rows } = grid.value
  const { width, height } = props.source
  const segments: string[] = []
  for (let index = 1; index < columns.length - 1; index += 1) {
    segments.push(`M${columns[index]} 0V${height}`)
  }
  for (let index = 1; index < rows.length - 1; index += 1) {
    segments.push(`M0 ${rows[index]}H${width}`)
  }
  return segments.join('')
})

const dragRect = computed<PixelRect | null>(() => {
  const drag = dragState.value
  return drag?.moved ? getSelectionRect(drag.start, drag.current, lockSquare.value) : null
})

const hoverCell = computed(() => {
  const point = hoverPoint.value
  if (!point || dragRect.value) {
    return null
  }

  const { columns, rows } = grid.value
  const column = getBlockIndex(columns, point.x)
  const row = getBlockIndex(rows, point.y)
  return {
    column,
    row,
    x: columns[column],
    y: rows[row],
    width: columns[column + 1] - columns[column],
    height: rows[row + 1] - rows[row],
    color: sampledBlocks.value ? getBlockColor(sampledBlocks.value, column, row) : null,
  }
})

function formatCount(value: number) {
  return value.toLocaleString('zh-CN')
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function getSelectionRect(start: PixelPoint, current: PixelPoint, square: boolean): PixelRect {
  const { width: imageWidth, height: imageHeight } = props.source
  const towardsRight = current.x >= start.x
  const towardsBottom = current.y >= start.y
  let width = Math.abs(current.x - start.x) + 1
  let height = Math.abs(current.y - start.y) + 1

  if (square) {
    const roomX = towardsRight ? imageWidth - start.x : start.x + 1
    const roomY = towardsBottom ? imageHeight - start.y : start.y + 1
    const side = Math.min(Math.max(width, height), roomX, roomY)
    width = side
    height = side
  }

  return {
    x: towardsRight ? start.x : start.x - width + 1,
    y: towardsBottom ? start.y : start.y - height + 1,
    width,
    height,
  }
}

function getPixelPoint(event: PointerEvent): PixelPoint | null {
  const frame = frameRef.value
  if (!frame) {
    return null
  }

  const rect = frame.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }

  const { width, height } = props.source
  return {
    x: clamp(Math.floor(((event.clientX - rect.left) / rect.width) * width), 0, width - 1),
    y: clamp(Math.floor(((event.clientY - rect.top) / rect.height) * height), 0, height - 1),
  }
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return
  }

  const point = getPixelPoint(event)
  if (!point) {
    return
  }

  event.preventDefault()
  if (event.currentTarget instanceof Element) {
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  hoverPoint.value = point
  dragState.value = {
    pointerId: event.pointerId,
    start: point,
    current: point,
    startClientX: event.clientX,
    startClientY: event.clientY,
    moved: false,
  }
}

function handlePointerMove(event: PointerEvent) {
  const point = getPixelPoint(event)
  if (!point) {
    return
  }

  hoverPoint.value = point
  const drag = dragState.value
  if (!drag || drag.pointerId !== event.pointerId) {
    return
  }

  drag.current = point
  if (
    !drag.moved &&
    Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) >= DRAG_THRESHOLD
  ) {
    drag.moved = true
  }
}

function handlePointerUp(event: PointerEvent) {
  const drag = dragState.value
  if (!drag || drag.pointerId !== event.pointerId) {
    return
  }

  const rect = dragRect.value
  dragState.value = null
  if (rect) {
    applySelection(rect)
  }
}

function handlePointerCancel() {
  dragState.value = null
}

function handlePointerLeave() {
  if (!dragState.value) {
    hoverPoint.value = null
  }
}

function applySelection(rect: PixelRect) {
  settings.blockWidth = rect.width
  settings.blockHeight = rect.height
  settings.offsetX = rect.x % rect.width
  settings.offsetY = rect.y % rect.height
}

function setBlockSize(axis: Axis, value: number) {
  if (!Number.isFinite(value)) {
    return
  }

  const size = clamp(Math.round(value), 1, maxBlockSize.value)
  if (axis === 'x' || lockSquare.value) {
    settings.blockWidth = size
  }
  if (axis === 'y' || lockSquare.value) {
    settings.blockHeight = size
  }
  settings.offsetX %= settings.blockWidth
  settings.offsetY %= settings.blockHeight
}

function setOffset(axis: Axis, value: number) {
  if (!Number.isFinite(value)) {
    return
  }

  if (axis === 'x') {
    settings.offsetX = clamp(Math.round(value), 0, settings.blockWidth - 1)
  } else {
    settings.offsetY = clamp(Math.round(value), 0, settings.blockHeight - 1)
  }
}

function handleSizeInput(axis: Axis, event: Event) {
  const target = event.currentTarget
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  setBlockSize(axis, target.valueAsNumber)
  // 输入被修正（如超出范围或为空）时，让输入框显示实际生效的值。
  target.value = String(axis === 'x' ? settings.blockWidth : settings.blockHeight)
}

function handleOffsetInput(axis: Axis, event: Event) {
  const target = event.currentTarget
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  setOffset(axis, target.valueAsNumber)
  target.value = String(axis === 'x' ? settings.offsetX : settings.offsetY)
}

function toggleLockSquare() {
  lockSquare.value = !lockSquare.value
  if (lockSquare.value) {
    setBlockSize('x', settings.blockWidth)
  }
}

function resetOffset() {
  settings.offsetX = 0
  settings.offsetY = 0
}

function resetToRecommended() {
  Object.assign(settings, recommendedSettings.value)
  lockSquare.value = true
}

function handleApply() {
  const blocks = sampledBlocks.value
  if (!blocks) {
    return
  }

  emit('apply', blocksToPixelArt(blocks, props.source.name), { ...safeSettings.value })
}

function handleCancel() {
  emit('cancel')
}

function drawSourceImage() {
  const canvas = sourceCanvasRef.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) {
    return
  }

  canvas.width = props.source.width
  canvas.height = props.source.height
  context.putImageData(props.source.imageData, 0, 0)
}

function drawResult() {
  const canvas = resultCanvasRef.value
  const blocks = sampledBlocks.value
  const context = canvas?.getContext('2d')
  if (!canvas || !blocks || !context) {
    return
  }

  canvas.width = blocks.columns
  canvas.height = blocks.rows
  const imageData = new ImageData(blocks.columns, blocks.rows)
  imageData.data.set(blocks.data)
  context.putImageData(imageData, 0, 0)
}

function updateDisplayScale() {
  const frame = frameRef.value
  displayScale.value = frame ? frame.getBoundingClientRect().width / props.source.width : 0
}

watch([sampledBlocks, resultCanvasRef], drawResult, { flush: 'post' })

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  dialogRef.value?.showModal()
  // 默认聚焦“应用”方便直接回车确认，但不要把弹窗滚到底部（窄屏时会看不到原图）。
  applyButtonRef.value?.focus({ preventScroll: true })
  if (dialogRef.value) {
    dialogRef.value.scrollTop = 0
  }
  drawSourceImage()
  drawResult()
  updateDisplayScale()

  if (frameRef.value) {
    resizeObserver = new ResizeObserver(updateDisplayScale)
    resizeObserver.observe(frameRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  dialogRef.value?.close()
})
</script>

<template>
  <dialog
    ref="dialogRef"
    class="preprocess-dialog"
    aria-labelledby="preprocess-title"
    aria-describedby="preprocess-description"
    @cancel.prevent="handleCancel"
  >
    <header class="preprocess-header">
      <div>
        <h2 class="preprocess-title">预处理</h2>
        <p id="preprocess-description" class="preprocess-subtitle">
          <span class="readout-tag">提示</span>
          <span>可通过在图上框出一个新像素对应的区域</span>
        </p>
      </div>
      <button class="dialog-close" type="button" aria-label="取消并关闭" @click="handleCancel">×</button>
    </header>

    <div class="preprocess-body">
      <section class="preprocess-stage-column" aria-label="原图与像素块网格">
        <div class="preprocess-stage">
          <div ref="frameRef" class="preprocess-frame" :style="frameStyle">
            <canvas ref="sourceCanvasRef" class="preprocess-source" :class="{ 'is-pixelated': isUpscaled }"></canvas>
            <svg
              class="preprocess-overlay"
              :viewBox="`0 0 ${source.width} ${source.height}`"
              preserveAspectRatio="none"
              aria-hidden="true"
              @pointerdown="handlePointerDown"
              @pointermove="handlePointerMove"
              @pointerup="handlePointerUp"
              @pointercancel="handlePointerCancel"
              @pointerleave="handlePointerLeave"
            >
              <template v-if="showGridLines">
                <path class="grid-line-shadow" :d="gridPath" vector-effect="non-scaling-stroke" />
                <path class="grid-line" :d="gridPath" vector-effect="non-scaling-stroke" />
              </template>
              <rect
                v-if="hoverCell"
                class="hover-cell"
                :x="hoverCell.x"
                :y="hoverCell.y"
                :width="hoverCell.width"
                :height="hoverCell.height"
                vector-effect="non-scaling-stroke"
              />
              <rect
                v-if="dragRect"
                class="selection-rect"
                :x="dragRect.x"
                :y="dragRect.y"
                :width="dragRect.width"
                :height="dragRect.height"
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </div>
          <span v-if="!showGridLines" class="stage-note">网格太密，已隐藏网格线</span>
        </div>

        <div class="preprocess-readout" aria-live="polite">
          <template v-if="dragRect">
            <span class="readout-tag">框选中</span>
            <span><strong>{{ dragRect.width }} × {{ dragRect.height }} px</strong>，松开后作为新的像素块大小，网格从框选处对齐</span>
          </template>
          <template v-else-if="hoverCell">
            <span
              class="readout-swatch"
              :class="{ 'is-empty': !hoverCell.color }"
              :style="hoverCell.color ? { backgroundColor: hoverCell.color } : undefined"
            ></span>
            <span>
              第 <strong>{{ hoverCell.row + 1 }}</strong> 行   第 <strong>{{ hoverCell.column + 1 }}</strong> 列  
              {{ hoverCell.width }} × {{ hoverCell.height }} px
              <template v-if="hoverCell.color"> → <strong>{{ hoverCell.color }}</strong></template>
            </span>
          </template>
        </div>
      </section>

      <aside class="preprocess-controls">
        <div class="preprocess-group">
          <div class="preprocess-section-heading">
            <span>像素块大小</span>
            <button class="reset-button" type="button" :disabled="isRecommended" @click="resetToRecommended">
              重置
            </button>
          </div>
          <div class="control-list">
            <div class="range-control">
              <div class="control-label">
                <label for="block-width">宽度 X</label>
                <span class="number-field">
                  <input
                    id="block-width"
                    class="number-input"
                    type="number"
                    min="1"
                    :max="maxBlockSize"
                    step="1"
                    :value="settings.blockWidth"
                    @change="handleSizeInput('x', $event)"
                  />
                  px
                </span>
              </div>
              <input
                type="range"
                min="1"
                :max="sliderMax"
                step="1"
                :value="settings.blockWidth"
                aria-label="像素块宽度"
                @input="handleSizeInput('x', $event)"
              />
            </div>

            <div class="range-control">
              <div class="control-label">
                <label for="block-height">高度 Y</label>
                <span class="number-field">
                  <input
                    id="block-height"
                    class="number-input"
                    type="number"
                    min="1"
                    :max="maxBlockSize"
                    step="1"
                    :value="settings.blockHeight"
                    @change="handleSizeInput('y', $event)"
                  />
                  px
                </span>
              </div>
              <input
                type="range"
                min="1"
                :max="sliderMax"
                step="1"
                :value="settings.blockHeight"
                aria-label="像素块高度"
                @input="handleSizeInput('y', $event)"
              />
            </div>
          </div>

          <button
            class="toggle-chip lock-toggle"
            :class="{ active: lockSquare }"
            type="button"
            :aria-pressed="lockSquare"
            @click="toggleLockSquare"
          >
            锁定为正方形
          </button>
        </div>

        <div class="preprocess-group">
          <div class="preprocess-section-heading">
            <span>网格起点</span>
            <button
              class="reset-button"
              type="button"
              :disabled="settings.offsetX === 0 && settings.offsetY === 0"
              @click="resetOffset"
            >
              重置
            </button>
          </div>
          <div class="offset-inputs">
            <label class="number-field">
              X
              <input
                class="number-input"
                type="number"
                min="0"
                :max="settings.blockWidth - 1"
                step="1"
                :value="settings.offsetX"
                aria-label="网格起点 X"
                @change="handleOffsetInput('x', $event)"
              />
            </label>
            <label class="number-field">
              Y
              <input
                class="number-input"
                type="number"
                min="0"
                :max="settings.blockHeight - 1"
                step="1"
                :value="settings.offsetY"
                aria-label="网格起点 Y"
                @change="handleOffsetInput('y', $event)"
              />
            </label>
          </div>
        </div>

        <div class="preprocess-group">
          <div class="preprocess-section-heading">
            <span>预览</span>
          </div>
          <div class="result-stage">
            <div v-if="sampledBlocks" class="result-frame" :style="resultFrameStyle">
              <canvas ref="resultCanvasRef" class="result-canvas" role="img" aria-label="合成后的像素画预览"></canvas>
            </div>
            <span v-else class="result-placeholder">瓷砖数量过多，暂不预览</span>
          </div>
          <p class="result-summary">
            
              原图 <strong>{{ source.width }} × {{ source.height }}</strong> px<br/>
            转换后共 <strong>{{ columnCount }} × {{ rowCount }} = {{ formatCount(tileCount) }}</strong> 块瓷砖
          </p>
        </div>

        <p v-if="isOverLimit" class="error-message" role="alert">
          当前会生成 {{ formatCount(tileCount) }} 块瓷砖，超过上限 {{ formatCount(MAX_TILE_COUNT) }}。请把像素块调大一些。
        </p>
      </aside>
    </div>

    <footer class="preprocess-footer">
      <p class="field-hint">每个像素块取区域内所有像素的平均色；图片边缘不足一整块的部分会单独成块。</p>
      <div class="export-actions">
        <button class="button button-secondary" type="button" @click="handleCancel">取消</button>
        <button
          ref="applyButtonRef"
          class="button button-primary"
          type="button"
          :disabled="isOverLimit"
          @click="handleApply"
        >
          确认
        </button>
      </div>
    </footer>
  </dialog>
</template>
