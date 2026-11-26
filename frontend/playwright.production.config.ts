import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig(base, {
  // Keep the production audit sequential on the local desktop/browser host.
  workers: 1,
  outputDir: 'test-results/production',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
