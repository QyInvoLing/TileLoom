<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import ImagePreprocessDialog from './components/ImagePreprocessDialog.vue'
import type { BlockSettings } from './lib/imageBlocks'
import { createSampleArt, decodeImageFile, type PixelArt, type SourceImage } from './lib/pixelArt'
import {
  DEFAULT_TILE_CONFIG,
  createSvgMarkup,
  getRenderSize,
  getTileCells,
  isTransparentColor,
  normalizeHexColor,
  sanitizeConfig,
  toColorPickerValue,
  type TileConfig,
} from './lib/tileRenderer'

type ColorField = 'borderColor' | 'gapColor'

interface Preset {
  id: string
  label: string
  description: string
  values: Pick<TileConfig, 'borderColor' | 'borderWidth' | 'radius' | 'gap' | 'gapColor'>
}

const sampleArt = createSampleArt()
const config = reactive<TileConfig>({ ...DEFAULT_TILE_CONFIG })
const colorDrafts = reactive<Record<ColorField, string>>({
  borderColor: config.borderColor,
  gapColor: config.gapColor,
})
const lastOpaqueColors = reactive<Record<ColorField, string>>({
  borderColor: config.borderColor,
  gapColor: config.gapColor,
})
const currentArt = ref<PixelArt>(sampleArt)
// 原图像素数据可能很大，用 shallowRef 避免深层响应式代理。
const currentSource = shallowRef<SourceImage | null>(null)
const appliedBlockSettings = ref<BlockSettings | null>(null)
const preprocessSource = shallowRef<SourceImage | null>(null)
const preprocessInitialSettings = ref<BlockSettings | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const exportMessage = ref('')
const activePresetId = ref('sea-salt')

const presets: Preset[] = [
  {
    id: 'sea-salt',
    label: '海盐白',
    description: '清爽浅色',
    values: {
      borderColor: '#F1EADD',
      borderWidth: 1,
      radius: 3,
      gap: 3,
      gapColor: '#163344',
    },
  },
  {
    id: 'mint-glaze',
    label: '薄荷釉',
    description: '柔和复古',
    values: {
      borderColor: '#D9E6D6',
      borderWidth: 2,
      radius: 6,
      gap: 5,
      gapColor: '#6E8D83',
    },
  },
  {
    id: 'night-blue',
    label: '午夜蓝',
    description: '深色对比',
    values: {
      borderColor: '#223F50',
      borderWidth: 1,
      radius: 1,
      gap: 2,
      gapColor: '#0C202E',
    },
  },
]

const effectiveConfig = computed(() => sanitizeConfig(config))
const renderSize = computed(() => getRenderSize(currentArt.value, effectiveConfig.value))
const tileCells = computed(() => getTileCells(currentArt.value, effectiveConfig.value))
const pixelCount = computed(() => currentArt.value.width * currentArt.value.height)
const sourcePreviewStyle = computed(() => ({
  gridTemplateColumns: `repeat(${currentArt.value.width}, minmax(0, 1fr))`,
}))
const previewLabel = computed(
  () => `${currentArt.value.name}，${currentArt.value.width} 乘 ${currentArt.value.height} 像素`,
)
const isSample = computed(() => currentArt.value.id === 'sample')

watch(
  () => config.borderColor,
  (value) => {
    colorDrafts.borderColor = value
    if (!isTransparentColor(value)) {
      lastOpaqueColors.borderColor = value
    }
  },
)
watch(
  () => config.gapColor,
  (value) => {
    colorDrafts.gapColor = value
    if (!isTransparentColor(value)) {
      lastOpaqueColors.gapColor = value
    }
  },
)

function triggerFilePicker() {
  fileInput.value?.click()
}

function getInputValue(event: Event): string | null {
  const target = event.currentTarget
  return target instanceof HTMLInputElement ? target.value : null
}

async function loadUploadedFile(file: File) {
  isLoading.value = true
  errorMessage.value = ''
  exportMessage.value = ''

  try {
    const source = await decodeImageFile(file)
    preprocessInitialSettings.value = null
    preprocessSource.value = source
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '图片读取失败，请换一张图片重试。'
  } finally {
    isLoading.value = false
  }
}

function handleFileInput(event: Event) {
  const target = event.currentTarget
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  const file = target.files?.[0]
  target.value = ''
  if (file) {
    void loadUploadedFile(file)
  }
}

function openPreprocess() {
  if (!currentSource.value) {
    return
  }

  preprocessInitialSettings.value = appliedBlockSettings.value
  preprocessSource.value = currentSource.value
}

function applyPreprocess(art: PixelArt, settings: BlockSettings) {
  currentSource.value = preprocessSource.value
  appliedBlockSettings.value = settings
  currentArt.value = art
  activePresetId.value = ''
  exportMessage.value = ''
  preprocessSource.value = null
}

function cancelPreprocess() {
  preprocessSource.value = null
}

function useSampleArt() {
  currentArt.value = sampleArt
  currentSource.value = null
  appliedBlockSettings.value = null
  errorMessage.value = ''
  exportMessage.value = ''
}

function applyPreset(preset: Preset) {
  config.borderColor = preset.values.borderColor
  config.borderWidth = preset.values.borderWidth
  config.radius = preset.values.radius
  config.gap = preset.values.gap
  config.gapColor = preset.values.gapColor
  activePresetId.value = preset.id
}

function resetConfig() {
  Object.assign(config, DEFAULT_TILE_CONFIG)
  activePresetId.value = 'sea-salt'
}

function handleColorPicker(field: ColorField, event: Event) {
  const value = getInputValue(event)
  if (!value) {
    return
  }

  const normalized = normalizeHexColor(value, config[field])
  if (!normalized) {
    return
  }

  config[field] = normalized
  lastOpaqueColors[field] = normalized
  activePresetId.value = ''
}

function handleColorDraft(field: ColorField, event: Event) {
  const value = getInputValue(event)
  if (value !== null) {
    colorDrafts[field] = value.toUpperCase()
  }
}

function commitColorDraft(field: ColorField) {
  const normalized = normalizeHexColor(colorDrafts[field], '')
  if (!normalized) {
    colorDrafts[field] = config[field]
    return
  }

  config[field] = normalized
  colorDrafts[field] = normalized
  if (!isTransparentColor(normalized)) {
    lastOpaqueColors[field] = normalized
  }
  activePresetId.value = ''
}

function toggleTransparentColor(field: ColorField) {
  if (isTransparentColor(config[field])) {
    const restored = lastOpaqueColors[field] || DEFAULT_TILE_CONFIG[field]
    config[field] = restored
    colorDrafts[field] = restored
  } else {
    lastOpaqueColors[field] = config[field]
    config[field] = 'transparent'
    colorDrafts[field] = 'transparent'
  }
  activePresetId.value = ''
}

function getDownloadName(extension: string) {
  return `tileloom-${currentArt.value.id === 'sample' ? 'sample' : 'preview'}.${extension}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadSvg() {
  exportMessage.value = ''

  try {
    const markup = createSvgMarkup(currentArt.value, effectiveConfig.value)
    const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
    downloadBlob(blob, getDownloadName('svg'))
    exportMessage.value = 'SVG 已准备下载'
  } catch (error) {
    exportMessage.value = error instanceof Error ? error.message : 'SVG 导出失败，请稍后重试。'
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </span>
        <span class="brand-copy">
          <strong>Tileloom</strong>
          <small>像素-瓷砖转换器。纯前端工具，图片不会被上传到任何地方</small>
        </span>
      </div>
    </header>

    <main>
      

      <section class="workspace" aria-label="瓷砖像素画工作区">
        <aside class="control-column">
          <section class="panel source-panel">
            <div class="panel-heading">
              <div>
                <span class="step-number">01</span>
                <div>
                  <h2>选择图片</h2>
                  <p>上传后划分像素块，每个像素块变成一块瓷砖</p>
                </div>
              </div>
            </div>

            <button class="upload-dropzone" type="button" :disabled="isLoading" @click="triggerFilePicker">
              <span class="upload-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <span class="upload-copy">
                <strong>{{ isLoading ? '正在读取图片…' : '上传像素画或照片' }}</strong>
                <small>PNG / JPG / WEBP / GIF 上传后可划分像素块</small>
              </span>
              <span class="upload-arrow" aria-hidden="true">↗</span>
            </button>
            <input
              id="pixel-art-upload"
              ref="fileInput"
              class="visually-hidden"
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"
              @change="handleFileInput"
            />

            <div class="source-preview">
              <div class="mini-art" :style="sourcePreviewStyle" aria-hidden="true">
                <span
                  v-for="(pixel, index) in currentArt.pixels"
                  :key="`source-pixel-${index}`"
                  class="mini-pixel"
                  :style="{ backgroundColor: pixel }"
                ></span>
              </div>
              <div class="source-details">
                <div>
                  <strong>{{ currentArt.name }}</strong>
                  <span>{{ currentArt.width }} × {{ currentArt.height }} px</span>
                  <span v-if="currentSource && appliedBlockSettings">
                    原图 {{ currentSource.width }} × {{ currentSource.height }} 每
                    {{ appliedBlockSettings.blockWidth }} × {{ appliedBlockSettings.blockHeight }} 合一
                  </span>
                </div>
                <div v-if="!isSample" class="source-actions">
                  <button v-if="currentSource" class="text-button" type="button" @click="openPreprocess">
                    重新划分
                  </button>
                  <button class="text-button" type="button" @click="useSampleArt">使用示例</button>
                </div>
              </div>
            </div>
            <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
            <p class="field-hint">像素画保持 1 × 1 即可；对于普通图片，可以把 X × Y 个像素合成一块瓷砖。透明像素会以暖白色显示。</p>
          </section>

          <section class="panel config-panel">
            <div class="panel-heading panel-heading-with-action">
              <div>
                <span class="step-number">02</span>
                <div>
                  <h2>调整瓷砖参数</h2>
                  <p>模拟真实铺贴时的材质比例</p>
                </div>
              </div>
              <button class="reset-button" type="button" @click="resetConfig">重置</button>
            </div>

            <div class="control-list">
              <div class="range-control">
                <div class="control-label">
                  <label for="tile-size">瓷砖尺寸</label>
                  <output for="tile-size">{{ config.tileSize }} px</output>
                </div>
                <input id="tile-size" v-model.number="config.tileSize" type="range" min="4" max="42" step="1" />
                <div class="range-scale"><span>4</span><span>42 px</span></div>
              </div>

              <div class="range-control">
                <div class="control-label">
                  <label for="border-width">边框宽度</label>
                  <output for="border-width">{{ config.borderWidth }} px</output>
                </div>
                <input id="border-width" v-model.number="config.borderWidth" type="range" min="0" max="42" step="1" />
                <div class="range-scale"><span>0</span><span>42 px</span></div>
              </div>

              <div class="range-control">
                <div class="control-label">
                  <label for="tile-radius">瓷砖圆角</label>
                  <output for="tile-radius">{{ config.radius }} px</output>
                </div>
                <input id="tile-radius" v-model.number="config.radius" type="range" min="0" max="12" step="1" />
                <div class="range-scale"><span>0</span><span>12 px</span></div>
              </div>

              <div class="range-control">
                <div class="control-label">
                  <label for="tile-gap">瓷砖缝隙</label>
                  <output for="tile-gap">{{ config.gap }} px</output>
                </div>
                <input id="tile-gap" v-model.number="config.gap" type="range" min="0" max="42" step="1" />
                <div class="range-scale"><span>0</span><span>42 px</span></div>
              </div>
            </div>

            <div class="color-controls">
              <div class="color-control">
                <span class="color-label">
                  <span
                    class="color-swatch border-swatch"
                    :class="{ 'is-transparent': isTransparentColor(config.borderColor) }"
                    :style="{ backgroundColor: effectiveConfig.borderColor }"
                  ></span>
                  瓷砖边框颜色
                </span>
                <span class="color-input-row">
                  <input
                    id="border-color"
                    class="color-picker"
                    type="color"
                    :value="toColorPickerValue(config.borderColor, lastOpaqueColors.borderColor)"
                    aria-label="选择瓷砖边框颜色"
                    @input="handleColorPicker('borderColor', $event)"
                  />
                  <input
                    class="hex-input"
                    type="text"
                    inputmode="text"
                    maxlength="11"
                    placeholder="#RRGGBB / transparent"
                    autocomplete="off"
                    spellcheck="false"
                    :value="colorDrafts.borderColor"
                    aria-label="输入瓷砖边框颜色，支持十六进制或 transparent"
                    @input="handleColorDraft('borderColor', $event)"
                    @blur="commitColorDraft('borderColor')"
                    @keydown.enter.prevent="commitColorDraft('borderColor')"
                  />
                  <button
                    class="transparent-toggle"
                    :class="{ active: isTransparentColor(config.borderColor) }"
                    type="button"
                    :aria-pressed="isTransparentColor(config.borderColor)"
                    title="将瓷砖边框设为透明"
                    @click="toggleTransparentColor('borderColor')"
                  >
                    透明
                  </button>
                </span>
              </div>
              <div class="color-control">
                <span class="color-label">
                  <span
                    class="color-swatch gap-swatch"
                    :class="{ 'is-transparent': isTransparentColor(config.gapColor) }"
                    :style="{ backgroundColor: effectiveConfig.gapColor }"
                  ></span>
                  瓷砖缝隙颜色
                </span>
                <span class="color-input-row">
                  <input
                    id="gap-color"
                    class="color-picker"
                    type="color"
                    :value="toColorPickerValue(config.gapColor, lastOpaqueColors.gapColor)"
                    aria-label="选择瓷砖缝隙颜色"
                    @input="handleColorPicker('gapColor', $event)"
                  />
                  <input
                    class="hex-input"
                    type="text"
                    inputmode="text"
                    maxlength="11"
                    placeholder="#RRGGBB / transparent"
                    autocomplete="off"
                    spellcheck="false"
                    :value="colorDrafts.gapColor"
                    aria-label="输入瓷砖缝隙颜色，支持十六进制或 transparent"
                    @input="handleColorDraft('gapColor', $event)"
                    @blur="commitColorDraft('gapColor')"
                    @keydown.enter.prevent="commitColorDraft('gapColor')"
                  />
                  <button
                    class="transparent-toggle"
                    :class="{ active: isTransparentColor(config.gapColor) }"
                    type="button"
                    :aria-pressed="isTransparentColor(config.gapColor)"
                    title="将瓷砖缝隙设为透明"
                    @click="toggleTransparentColor('gapColor')"
                  >
                    透明
                  </button>
                </span>
              </div>
            </div>

            <div class="preset-section">
              <div class="preset-heading">
                <span>预设颜色</span>
              </div>
              <div class="preset-list">
                <button
                  v-for="preset in presets"
                  :key="preset.id"
                  class="preset-button"
                  :class="{ active: activePresetId === preset.id }"
                  type="button"
                  @click="applyPreset(preset)"
                >
                  <span class="preset-dot" :style="{ backgroundColor: preset.values.gapColor }"></span>
                  <span>
                    <strong>{{ preset.label }}</strong>
                    <small>{{ preset.description }}</small>
                  </span>
                  <span v-if="activePresetId === preset.id" class="preset-check" aria-hidden="true">✓</span>
                </button>
              </div>
            </div>
          </section>
        </aside>

        <section class="preview-panel">
          <div class="preview-toolbar">
            <div class="preview-heading">
              <h2>墙面效果图</h2>
              <p>共 <strong>{{ pixelCount }}</strong> 块瓷砖</p>
            </div>
            <div class="export-actions">
              <!-- <button class="button button-secondary" type="button" :disabled="isLoading" @click="downloadPng">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                保存 PNG
              </button> -->
              <button class="button button-primary" type="button" :disabled="isLoading" @click="downloadSvg">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6.5 4.5h8l3 3V19a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
                  <path d="M14.5 4.5v3h3M8 15.5l2-2 2 2 2-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                保存 SVG
              </button>
            </div>
          </div>

          <div class="preview-stage" :class="{ 'is-loading': isLoading }">
            <span class="stage-label stage-label-top">{{ currentArt.width }} × {{ currentArt.height }}</span>
            <span class="stage-label stage-label-bottom">{{ renderSize.width }} × {{ renderSize.height }} px</span>
            <span class="stage-corner stage-corner-top-left" aria-hidden="true"></span>
            <span class="stage-corner stage-corner-top-right" aria-hidden="true"></span>
            <span class="stage-corner stage-corner-bottom-left" aria-hidden="true"></span>
            <span class="stage-corner stage-corner-bottom-right" aria-hidden="true"></span>

            <svg
              class="tile-preview-svg"
              :viewBox="`0 0 ${renderSize.width} ${renderSize.height}`"
              role="img"
              :aria-label="previewLabel"
              shape-rendering="geometricPrecision"
            >
              <title>{{ previewLabel }}</title>
              <rect :width="renderSize.width" :height="renderSize.height" :fill="effectiveConfig.gapColor" />
              <rect
                v-for="cell in tileCells"
                :key="cell.key"
                :x="cell.x"
                :y="cell.y"
                :width="cell.width"
                :height="cell.height"
                :rx="cell.radius"
                :fill="cell.color"
                :stroke="effectiveConfig.borderColor"
                :stroke-width="effectiveConfig.borderWidth"
                stroke-linejoin="round"
              />
            </svg>
            <div v-if="isLoading" class="preview-loading" role="status">
              <span class="loading-spinner"></span>
              正在生成预览…
            </div>
          </div>
        </section>
      </section>
    </main>

    <ImagePreprocessDialog
      v-if="preprocessSource"
      :source="preprocessSource"
      :initial-settings="preprocessInitialSettings"
      @apply="applyPreprocess"
      @cancel="cancelPreprocess"
    />
  </div>
</template>
