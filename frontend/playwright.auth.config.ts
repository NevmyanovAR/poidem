import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig(base, {
  testMatch: 'auth.spec.ts',
  testIgnore: [],
  workers: 1,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4173' },
  webServer: [
    {
      command: process.platform === 'win32' ? '"..\\backend\\.venv\\Scripts\\python.exe" "..\\scripts\\serve_test_api.py"' : '../backend/.venv/bin/python ../scripts/serve_test_api.py',
      url: 'http://127.0.0.1:8002/health', timeout: 30000, reuseExistingServer: false,
    },
    {
      command: 'npm run build && npm run preview',
      env: { VITE_API_BASE_URL: '/api/v1', POIDEM_API_PROXY_TARGET: 'http://127.0.0.1:8002' },
      url: 'http://127.0.0.1:4173', timeout: 60000, reuseExistingServer: false,
    },
  ],
})
