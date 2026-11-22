import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'

const state = JSON.parse(readFileSync(new URL('../.local/quick-tunnel.json', import.meta.url), 'utf8'))
if (state.stopped_at || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(state.origin)) {
  throw new Error('Сначала запустите действующий Quick Tunnel к Vite 5173')
}

export default defineConfig({
  testDir: './tests', testMatch: '**/tunnel.spec.ts', workers: 1,
  retries: 0, forbidOnly: true, reporter: 'list',
  outputDir: 'test-results/tunnel',
  use: {
    baseURL: state.origin, channel: 'chrome', headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'off', screenshot: 'only-on-failure',
  },
  // Без webServer: только уже запущенный настоящий API 8001 через Vite 5173.
})
