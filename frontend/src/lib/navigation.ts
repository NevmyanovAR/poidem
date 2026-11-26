// Только внутренние маршруты; состояние не содержит пользовательских данных.
export function returnTarget(state: unknown, fallback: string): string {
  const target = state && typeof state === 'object' && 'returnTo' in state ? state.returnTo : null
  return typeof target === 'string' && (/^\/plans(?:\?tab=(?:own|outgoing|incoming|archive)(?:&plan=[0-9a-f-]{36})?)?$/.test(target) || target === '/chats' || target === '/catalog') ? target : fallback
}
