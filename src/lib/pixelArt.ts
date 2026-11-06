export interface PixelArt {
  id: string
  name: string
  width: number
  height: number
  pixels: string[]
}

/** 上传图片的原始像素，供预处理时按像素块重新取样。 */
export interface SourceImage {
  name: string
  width: number
  height: number
  imageData: ImageData
}

/** 透明像素会叠在这个暖白色上再计算颜色。 */
export const TRANSPARENT_BACKGROUND = { r: 247, g: 241, b: 232 }
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

function setPixel(pixels: string[], width: number, x: number, y: number, color: string) {
  if (x < 0 || x >= width || y < 0) {
    return
  }

  const index = y * width + x
  if (index < pixels.length) {
    pixels[index] = color
  }
}

function paintRect(
  pixels: string[],
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: string,
) {
  for (let row = 0; row < rectHeight; row += 1) {
    for (let column = 0; column < rectWidth; column += 1) {
      setPixel(pixels, width, x + column, y + row, color)
    }
  }
}

function paintCircle(pixels: string[], width: number, centerX: number, centerY: number, radius: number, color: string) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        setPixel(pixels, width, x, y, color)
      }
    }
  }
}

export function createSampleArt(): PixelArt {
  const width = 28
  const height = 18
  const sky = '#18384E'
  const pixels = Array.from({ length: width * height }, () => sky)
  const cloud = '#F2DEC0'
  const sun = '#F5B766'
  const sunLight = '#FFD68D'
  const mountain = '#2A6971'
  const mountainLight = '#4D8C88'
  const water = '#2D7D86'
  const waterDeep = '#1A5C6D'
  const foam = '#ACD7C7'
  const foreground = '#113546'
  const shell = '#E9B978'
  const coral = '#D96F60'

  paintRect(pixels, width, 2, 4, 6, 2, cloud)
  paintRect(pixels, width, 3, 3, 3, 1, cloud)
  paintRect(pixels, width, 20, 3, 2, 1, cloud)
  paintRect(pixels, width, 19, 4, 5, 2, cloud)

  paintCircle(pixels, width, 14, 5, 4, sun)
  paintRect(pixels, width, 12, 3, 5, 4, sun)
  paintRect(pixels, width, 13, 4, 3, 2, sunLight)

  for (let x = 0; x < width; x += 1) {
    const leftMountainTop = Math.max(7, Math.round(11 - Math.abs(x - 6) * 0.65))
    const rightMountainTop = Math.max(8, Math.round(11 - Math.abs(x - 18) * 0.55))
    const mountainTop = x < 13 ? leftMountainTop : rightMountainTop
    for (let y = mountainTop; y < 12; y += 1) {
      setPixel(pixels, width, x, y, mountain)
    }
  }

  paintRect(pixels, width, 2, 10, 5, 1, mountainLight)
  paintRect(pixels, width, 17, 10, 4, 1, mountainLight)

  for (let y = 11; y < height; y += 1) {
    paintRect(pixels, width, 0, y, width, 1, y > 15 ? waterDeep : water)
  }

  for (let y = 12; y < 18; y += 2) {
    const offset = y % 4
    for (let x = offset; x < width - 2; x += 7) {
      paintRect(pixels, width, x, y, 3, 1, foam)
    }
  }

  paintRect(pixels, width, 0, 15, 8, 3, foreground)
  paintRect(pixels, width, 22, 16, 6, 2, foreground)
  paintRect(pixels, width, 3, 14, 2, 1, shell)
  paintRect(pixels, width, 24, 14, 1, 2, coral)
  paintRect(pixels, width, 23, 15, 3, 1, coral)

  const stars = [
    [4, 1],
    [8, 2],
    [24, 1],
    [26, 5],
    [10, 6],
  ]
  stars.forEach(([x, y]) => setPixel(pixels, width, x, y, '#D3E7D2'))

  return {
    id: 'sample',
    name: '海岸晚霞   示例',
    width,
    height,
    pixels,
  }
}

function toHex(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase()
}

export function rgbToHex(red: number, green: number, blue: number) {
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function readSourceImage(image: HTMLImageElement, name: string): SourceImage {
  const width = image.naturalWidth
  const height = image.naturalHeight

  if (!width || !height) {
    throw new Error('这张图片没有可读取的像素尺寸。')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('浏览器无法创建像素读取画布。')
  }

  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  return {
    name,
    width,
    height,
    imageData: context.getImageData(0, 0, width, height),
  }
}

export function decodeImageFile(file: File): Promise<SourceImage> {
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  if (!SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase()) && !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('暂不支持这种图片格式，请上传 PNG、JPG、WEBP 或 GIF。')
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      try {
        resolve(readSourceImage(image, file.name))
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图片读取失败，请确认文件没有损坏。'))
    }

    image.src = objectUrl
  })
}
