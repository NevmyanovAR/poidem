// Публичный снимок генерируется из backend. Сервер повторно проверяет любую запись.
import policy from '../config/contentPolicy.generated.json' with { type: 'json' }

const regex = (source: string) => new RegExp(source, 'u')
const dictionary = new Set([...policy.russian, ...policy.english])
const dictionaryWords = [...dictionary]
const bare = new Set(policy.russian.map(word => word.replace(/[ьъ]/gu, '')))
const neutralLatin = new Set(policy.neutralLatin)
const rules = policy.context.map(rule => ({ ...rule, patterns: rule.patterns.map(regex) }))
const neutralPrefix = regex(policy.neutralPrefix)
const topicPrefix = regex(policy.topicPrefix)
const topicCodes = new Set(policy.topicCodes)

const translate = (value: string, table: Record<string, string>) => [...value].map(char => table[char] ?? char).join('')
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const matches = (value: string) => [...value.matchAll(new RegExp(policy.word, 'gu'))].map(match => match[0])

function surface(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/ß/gu, 'ss').replace(/ё/gu, 'е').replace(/[\p{Cf}\p{Mn}\p{Me}]/gu, '')
}

function variants(word: string): Set<string> {
  word = word.replaceAll('@', 'a').replaceAll('$', 's')
  const values = new Set([word, translate(word, policy.visual), translate(word, policy.digits)])
  if (/[a-z]/u.test(word)) {
    const sounds = translate(word, policy.digits).replace(new RegExp(policy.pairs, 'gu'), part => (policy.sounds as Record<string, string>)[part])
    const phonetic = translate(sounds, policy.latin)
    values.add(phonetic).add(phonetic.replaceAll('й', 'ы')).add(translate(sounds.replaceAll('c', 'ц'), policy.latin))
  }
  for (const value of [...values]) values.add(value.replace(/(.)\1+/gu, '$1'))
  return values
}

function profaneWord(word: string): boolean {
  if (neutralLatin.has(word)) return false
  for (const variant of variants(word)) {
    if (dictionary.has(variant) || bare.has(variant)) return true
    if (!variant.includes('*')) continue
    const unmasked = variant.replaceAll('*', '')
    if (dictionary.has(unmasked)) return true
    if ([...variant].filter(char => char === '*').length <= 3 && unmasked.length >= 2) {
      const mask = regex(`^(?:${escape(variant).replaceAll('\\*', '[а-яa-z]{1,3}')})$`)
      if (dictionaryWords.some(entry => mask.test(entry))) return true
    }
  }
  return false
}

function hasProfanity(value: string): boolean {
  const checked = new Set<string>()
  const check = (word: string) => {
    if (checked.has(word)) return false
    checked.add(word)
    return profaneWord(word)
  }
  let raw = surface(value).replaceAll('@', 'a').replaceAll('$', 's')
  for (const match of [...raw.matchAll(new RegExp(policy.termReference, 'gu'))].reverse()) {
    const term = match.groups?.term ?? match.groups?.title ?? ''
    const start = match.index + match[0].lastIndexOf(term)
    raw = raw.slice(0, start) + ' '.repeat(term.length) + raw.slice(start + term.length)
  }
  raw = raw.replace(/(?<=[\p{L}\p{N}_])!(?=[\p{L}\p{N}_])/gu, 'i')
  const compact = raw.replace(/(?<=[\p{L}\p{N}_])[.·_-](?=[\p{L}\p{N}_])/gu, '')
  if (compact !== raw && matches(compact).some(check)) return true
  const words = matches(raw)
  if (words.some(check)) return true
  for (let start = 0; start < words.length; start++) {
    if (words[start].length > 3) continue
    const parts = [words[start]]
    for (const following of words.slice(start + 1, start + 8)) {
      if (following.length > 3 || parts.join('').length + following.length > 24) break
      parts.push(following)
      if (parts.some(part => part.length === 1) && check(parts.join(''))) return true
    }
  }
  return false
}

export function normalizedContentText(value: string): string {
  return surface(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function contentError(value: string): string | undefined {
  if (hasProfanity(value)) return policy.profanityMessage
  for (const clause of value.split(/(?<![\p{L}\p{N}_])[.!?;]|[.!?;](?![\p{L}\p{N}_])|\n/u)) {
    const clean = normalizedContentText(clause.replaceAll('@', 'a').replaceAll('$', 's'))
    const phonetic = clean.replace(/[a-z0-9]+/gu, word => translate(
      translate(word, policy.digits).replace(new RegExp(policy.pairs, 'gu'), pair => (policy.sounds as Record<string, string>)[pair]), policy.latin,
    ))
    const values = [clean, translate(clean, policy.visual), phonetic]
    for (const variant of new Set([...values, ...values.map(value => value.replace(/(.)\1+/gu, '$1'))])) {
      for (const rule of rules) {
        for (const pattern of rule.patterns) {
          for (const match of variant.matchAll(new RegExp(pattern.source, 'gu'))) {
            const before = variant.slice(0, match.index)
            if (topicCodes.has(rule.code) && topicPrefix.test(before)) continue
            if (!neutralPrefix.test(before)) return rule.message
          }
        }
      }
    }
  }
}

export const contentPolicyVersion = policy.version
