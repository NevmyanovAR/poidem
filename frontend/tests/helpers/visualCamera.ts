import type { Page } from '@playwright/test'

// Synthetic UI frames only. WebKit fallback does not test camera playback/permission.
export async function installVisualCamera(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 640
      const ctx = canvas.getContext('2d')!; let live = true
      const draw = () => { if (!live) return; ctx.fillStyle = '#550707'; ctx.fillRect(0,0,480,640); ctx.fillStyle = '#B8E4FF'; ctx.fillRect(180,150,120,160); requestAnimationFrame(draw) }; draw()
      if (typeof canvas.captureStream === 'function') { const stream = canvas.captureStream(10); stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { live = false; stop() } }); return stream }
      const streams = new WeakMap<HTMLMediaElement, unknown>()
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get() { return streams.get(this) ?? null }, set(value) { streams.set(this,value) } })
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 480 })
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 640 })
      HTMLMediaElement.prototype.play = async function () {}
      const drawImage = CanvasRenderingContext2D.prototype.drawImage
      CanvasRenderingContext2D.prototype.drawImage = function (image,...args) { if (image instanceof HTMLVideoElement) { this.fillStyle = '#550707'; this.fillRect(0,0,this.canvas.width,this.canvas.height); return } drawImage.apply(this,[image,...args] as Parameters<typeof drawImage>) }
      return { getTracks: () => [{ stop: () => { live = false } }] }
    } } })
  })
}
