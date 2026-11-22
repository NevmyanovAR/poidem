import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const frontendRoot = fileURLToPath(new URL('./', import.meta.url))
  const env = loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), ['POIDEM_API_', 'POIDEM_DEV_', 'VITE_API_BASE_URL'])
  const target = env.POIDEM_API_PROXY_TARGET || 'http://127.0.0.1:8001'
  let allowedHosts: string[]
  try {
    allowedHosts = JSON.parse(env.POIDEM_DEV_ALLOWED_HOSTS || '[]')
    if (!Array.isArray(allowedHosts) || allowedHosts.some(host => typeof host !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/i.test(host))) throw new Error()
    const proxy = new URL(target)
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) throw new Error()
    if (env.VITE_API_BASE_URL) {
      const api = new URL(env.VITE_API_BASE_URL, 'http://localhost')
      if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password) throw new Error()
    }
  } catch { throw new Error('Проверь публичные адреса API и POIDEM_DEV_ALLOWED_HOSTS; пароли в URL не допускаются') }
  return {
  plugins: [react()],
  envDir: '..', // В bundle попадают только VITE_ переменные, без серверного токена.
  server: {
    allowedHosts,
    fs: {
      strict: true,
      allow: [frontendRoot],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/.tools/**', '**/backend/**', '**/references/**'],
    },
    proxy: { '/api': { target, changeOrigin: true } },
  },
  preview: { allowedHosts, proxy: { '/api': { target, changeOrigin: true } } },
  }
})
