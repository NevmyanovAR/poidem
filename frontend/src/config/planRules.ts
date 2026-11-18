// Frontend contract only. A future backend must provide and enforce these settings.
export const PLAN_LIMITS = Object.freeze({ responsesPerPlan: 15, creationsPerDay: 3 })

const wholeWords = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'u')
const spaced = (word: string) => [...word].join('\\s*')

export const PLAN_TEXT_RULES = [
  {
    id: 'strip-club',
    message: 'В планах нельзя предлагать посещение стрип-клубов',
    patterns: [
      wholeWords(`${spaced('стрип')}(?:\\s*${spaced('тиз')})?\\s*(?:${spaced('клуб')}|клаб)(?:а|у|е|ом|ы|ов|ам|ами|ах)?`),
      wholeWords('strip(?:tease)?\\s*clubs?'),
    ],
  },
  {
    id: 'abandoned-building',
    message: 'Выбери безопасное место вместо заброшенного здания или сооружения',
    patterns: [
      wholeWords('заброшк(?:а|и|е|у|ой|ою|ам|ами|ах)?'),
      wholeWords('заброшенн[а-я]{1,6}\\s+(?:здани[а-я]*|сооружени[а-я]*|дом(?:а|е|у|ом|ов|ы|ах)?|завод[а-я]*|больниц[а-я]*|склад[а-я]*)'),
      wholeWords('(?:здани[а-я]*|сооружени[а-я]*)\\s+заброшенн[а-я]{1,6}'),
      wholeWords('abandoned\\s+(?:buildings?|structures?|houses?|factories|factory)'),
    ],
  },
] as const
