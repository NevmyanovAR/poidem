// Только удаление устаревших данных. Они никогда не читаются и не импортируются.
export function clearLegacyData(includePrototype = false): void {
  try {
    const keys = ['poidem:simulation:v1', 'poidem:demo-mode:v1']
    // Старый обычный профиль не импортируем и удаляем только по явному действию.
    if (includePrototype) keys.push('poidem:demo:v1')
    for (const key of keys) {
      localStorage.removeItem(key)
    }
  } catch { /* Отсутствие localStorage не мешает серверному входу */ }
}
