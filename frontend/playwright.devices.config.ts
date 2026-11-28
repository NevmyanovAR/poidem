import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests', testMatch: ['**/visual-polish.spec.ts', '**/free-places-reputation.spec.ts', '**/local-places.spec.ts', '**/photo-verification.spec.ts', '**/plans.spec.ts', '**/final-mobile.spec.ts', '**/connections.spec.ts', '**/chat-archive.spec.ts', '**/cards-ux.spec.ts', '**/response-history.spec.ts', '**/moderation.spec.ts', '**/settings-ux.spec.ts', '**/meeting-feedback.spec.ts', '**/plan-detail-ux.spec.ts', '**/navigation-chats.spec.ts', '**/admin-dashboard.spec.ts', '**/admin-management.spec.ts', '**/user-ux-stage10.spec.ts'], workers: 1,
  outputDir: 'test-results/devices',
  retries: 0, forbidOnly: true, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'android-chrome', use: { ...devices['Pixel 5'], browserName: 'chromium', channel: 'chrome' } },
  ],
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 30000 },
})
