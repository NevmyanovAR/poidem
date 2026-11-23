"""Ограниченная нормализация слов; без неограниченного склеивания текста."""

import re
import unicodedata

from poidem.services.content_vocabulary import ENGLISH_WORDS, NEUTRAL_LATIN_WORDS, RUSSIAN_WORDS

_VISUAL = str.maketrans(
    {
        "a": "а",
        "c": "с",
        "e": "е",
        "o": "о",
        "p": "р",
        "x": "х",
        "y": "у",
        "k": "к",
        "m": "м",
        "t": "т",
        "b": "в",
        "h": "н",
        "і": "и",
        "i": "и",
        "u": "и",
        "ј": "й",
        "α": "а",
        "ε": "е",
        "ο": "о",
        "ρ": "р",
        "χ": "х",
        "υ": "у",
        "κ": "к",
        "τ": "т",
        "0": "о",
        "1": "и",
        "3": "з",
        "4": "ч",
        "6": "б",
        "8": "в",
        "7": "т",
    }
)
_DIGITS = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t"})
_LATIN = str.maketrans(
    dict(zip("abcdefghijklmnopqrstuvwxyz", "абкдефгхийклмнопкрстуввхйз", strict=True))
)
_PAIRS = re.compile("shch|sch|zh|kh|ch|sh|ts|yo|jo|ye|yu|ju|ya|ja")
_SOUNDS = {
    "shch": "щ",
    "sch": "щ",
    "zh": "ж",
    "kh": "х",
    "ch": "ч",
    "sh": "ш",
    "ts": "ц",
    "yo": "е",
    "jo": "е",
    "ye": "е",
    "yu": "ю",
    "ju": "ю",
    "ya": "я",
    "ja": "я",
}
_WORD = re.compile(r"[^\W_]+(?:\*+[^\W_]+)*")
_DICTIONARY = RUSSIAN_WORDS | ENGLISH_WORDS
_BARE = frozenset(word.replace("ь", "").replace("ъ", "") for word in RUSSIAN_WORDS)
_TERM_REFERENCE = re.compile(
    r"(?:этимология|происхождение|значение|история|обсуждение)\s+(?:слова|термина)\s+"
    r"[«\"“']?(?P<term>[^\W_]+)[»\"”']?|"
    r"(?:роман|романа|романе)\s+[«\"“']?(?P<title>идиот)[»\"”']?(?!\w)"
)


def surface(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().replace("ё", "е")
    return "".join(char for char in value if unicodedata.category(char) not in {"Cf", "Mn", "Me"})


def word_variants(word: str) -> set[str]:
    word = word.replace("@", "a").replace("$", "s")
    variants = {word, word.translate(_VISUAL), word.translate(_DIGITS)}
    if re.search("[a-z]", word):
        phonetic = _PAIRS.sub(lambda match: _SOUNDS[match[0]], word.translate(_DIGITS)).translate(
            _LATIN
        )
        ts_variant = (
            _PAIRS.sub(lambda match: _SOUNDS[match[0]], word.translate(_DIGITS))
            .replace("c", "ц")
            .translate(_LATIN)
        )
        variants.update((phonetic, phonetic.replace("й", "ы"), ts_variant))
    # Дополнительная кандидатная форма; исходная никогда не заменяется.
    return variants | {re.sub(r"(.)\1+", r"\1", variant) for variant in variants}


def _is_profane(word: str) -> bool:
    if word in NEUTRAL_LATIN_WORDS:
        return False
    for variant in word_variants(word):
        if variant in _DICTIONARY or variant in _BARE:
            return True
        if "*" not in variant:
            continue
        if variant.replace("*", "") in _DICTIONARY:
            return True
        # Маска только внутри слова, максимум 3 группы по 1–3 буквы.
        if variant.count("*") <= 3 and len(variant.replace("*", "")) >= 2:
            pattern = re.compile(re.escape(variant).replace(r"\*", "[а-яa-z]{1,3}"))
            if any(pattern.fullmatch(entry) for entry in _DICTIONARY):
                return True
    return False


def has_profanity(value: str) -> bool:
    # Повторы проверяем один раз в пределах вызова; пользовательский текст не
    # попадает в долгоживущий глобальный кэш.
    checked: set[str] = set()

    def check(word: str) -> bool:
        if word in checked:
            return False
        checked.add(word)
        return _is_profane(word)

    raw = surface(value).replace("@", "a").replace("$", "s")
    # Локальная ссылка на конкретный термин/название, а не пропуск всего текста.
    for match in reversed(list(_TERM_REFERENCE.finditer(raw))):
        start, end = match.span("term" if match["term"] else "title")
        raw = raw[:start] + " " * (end - start) + raw[end:]
    raw = re.sub(r"(?<=\w)!(?=\w)", "i", raw)
    # Пунктуация внутри одного написания: ху-есос, п.и.з.д.а; не между словами.
    compact = re.sub(r"(?<=\w)[.·_\-](?=\w)", "", raw)
    if compact != raw and any(check(word) for word in _WORD.findall(compact)):
        return True
    words = _WORD.findall(raw)
    if any(check(word) for word in words):
        return True
    # Х у й / е-б-а-ть: склеиваем только короткие фрагменты с одиночной буквой,
    # не все соседние слова. Размер окна и длина кандидата ограничены.
    for start, word in enumerate(words):
        if len(word) > 3:
            continue
        parts = [word]
        for following in words[start + 1 : start + 8]:
            if len(following) > 3 or len("".join(parts)) + len(following) > 24:
                break
            parts.append(following)
            if any(len(part) == 1 for part in parts) and check("".join(parts)):
                return True
    return False


def phrase_variants(value: str) -> tuple[str, ...]:
    value = surface(value).replace("@", "a").replace("$", "s")
    clean = " ".join("".join(char if char.isalnum() else " " for char in value).split())
    visual = clean.translate(_VISUAL)
    phonetic = re.sub(
        r"[a-z0-9]+",
        lambda match: _PAIRS.sub(
            lambda pair: _SOUNDS[pair[0]], match[0].translate(_DIGITS)
        ).translate(_LATIN),
        clean,
    )
    variants = (clean, visual, phonetic)
    return tuple(dict.fromkeys((*variants, *(re.sub(r"(.)\1+", r"\1", v) for v in variants))))
