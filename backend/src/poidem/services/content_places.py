"""D48: словоформы запрещённых локаций и явно названных наркотиков.

Не запрещаем обычные бары, общественные крыши, стройматериалы, садовую траву,
пищевую соль, книжные закладки и героинь книг по совпадению фрагмента слова.
"""


def spelled(word: str) -> str:
    return r"\s*".join(word)


def forms(stem: str, endings: str = "", *, bare: bool = True) -> str:
    tails = [spelled(ending) for ending in endings.split()]
    if bare:
        tails.append("")
    return spelled(stem) + (r"\s*(?:" + "|".join(tails) + ")" if tails else "")


_NOUN = "а у е ом ем ы и ов ам ами ах"
_FEM = "а ы и у е ой ою ам ами ах"
_ADJ = "ый ий ой ая ое ые ие ого его ому ему ым им ом ем ую ых их ыми ими"
_CLUB = "(?:" + "|".join(forms(stem, _NOUN) for stem in ("клуб", "клаб", "бар")) + ")"
_STRIP = forms("стриптиз", "а у ом е ы ов ный ная ное ные ного ную ных ном ным ными")
_STRUCTURES = [
    forms(stem, _NOUN)
    for stem in (
        "дом",
        "завод",
        "склад",
        "цех",
        "ангар",
        "бункер",
        "коллектор",
        "подвал",
        "кинотеатр",
        "элеватор",
        "комбинат",
        "корпус",
        "мост",
        "объект",
        "гараж",
        "полигон",
    )
]
_STRUCTURES += [
    forms(stem, "е я ю ем и й ям ями ях", bare=False)
    for stem in (
        "здани",
        "строени",
        "сооружени",
        "общежити",
        "предприяти",
        "подземель",
    )
]
_STRUCTURES += [
    forms(stem, _FEM, bare=False)
    for stem in (
        "больниц",
        "психбольниц",
        "фабрик",
        "шахт",
        "водокачк",
        "баз",
        "стройк",
        "крыш",
        "казарм",
        "тюрьм",
        "ферм",
        "дамб",
        "вышк",
    )
]
_STRUCTURES += [forms("депо"), forms("промзон", _FEM, bare=False)]
_STRUCTURES += [
    forms(stem, "ь я ю ем е и ей ям ями ях", bare=False)
    for stem in ("тоннел", "туннел", "отел", "госпитал")
]
_STRUCTURES += [forms("санатори", "й я ю ем и ев ям ями ях", bare=False)]
_STRUCTURES += [forms("котельн", "я и ю ей е ям ями ях", bare=False)]
_STRUCTURES += [
    forms(stem, "я и ю ей е ям ями ях", bare=False) for stem in ("станци", "конструкци")
]
_BUILDING = "(?:" + "|".join(_STRUCTURES) + ")"
_UNSAFE = (
    "(?:"
    + "|".join(
        forms(stem, _ADJ, bare=False)
        for stem in (
            "заброшенн",
            "заброшен",
            "аварийн",
            "ветх",
            "покинут",
            "законсервированн",
            "недостроенн",
        )
    )
    + ")"
)
_DRUGS = [
    forms(stem, _NOUN)
    for stem in (
        "наркотик",
        "кокаин",
        "героин",
        "мефедрон",
        "амфетамин",
        "метамфетамин",
        "каннабис",
        "гашиш",
        "спайс",
        "меф",
        "метадон",
        "дезоморфин",
        "опиум",
        "фентанил",
        "кетамин",
        "психоделик",
        "галлюциноген",
    )
]
_DRUGS += [forms(stem, _FEM, bare=False) for stem in ("наркот", "марихуан", "анаш")]
_DRUGS += [forms("наркотическ", _ADJ, bare=False)]
_DRUGS += [forms("опи", "й я ю ем и ев ям ями ях", bare=False)]
_DRUGS += [
    spelled(word)
    for word in (
        "экстази",
        "мдма",
        "лсд",
        "mdma",
        "lsd",
        "cocaine",
        "heroin",
        "methamphetamine",
        "marijuana",
        "cannabis",
        "ecstasy",
        "narcotics",
        "drugs",
        "drug",
    )
]
_ROOF = forms("крыш", _FEM, bare=False)
_SITE = forms("стройк", _FEM, bare=False)
_CLOSED = (
    "(?:"
    + "|".join(
        forms(stem, _ADJ, bare=False)
        for stem in (
            "закрыт",
            "запретн",
            "охраняем",
            "огороженн",
        )
    )
    + ")"
)
_INTRUDE = r"(?:проберемся|пробраться|проникнем|проникнуть|прокрадемся|прокрасться)"

# Каждая запись оборачивается в Unicode-границы слов в content_context.
PLACE_RULES = (
    (
        "strip-topic",
        "В планах нельзя предлагать стриптиз и посещение стрип-клубов",
        (
            _STRIP + r"(?:\s*" + _CLUB + ")?",
            forms("стриптизерш", _FEM, bare=False),
            forms("стриптизер", _NOUN),
            spelled("стрип") + r"\s*" + _CLUB,
            spelled("striptease") + r"s?",
            spelled("striptiz") + r"(?:a|om)?",
            spelled("strip") + r"\s*(?:clubs?|bars?)",
            r"(?:шоу|танец|выступление|клуб)\s+стриптизерш(?:а|и|у|ей)?",
            r"(?:клуб|шоу)\s+стриппер(?:ов|ы|а)",
        ),
    ),
    (
        "abandoned-building",
        "Выбери безопасное место вместо заброшенного здания или сооружения",
        (
            forms("заброшк", _FEM, bare=False),
            _UNSAFE
            + r"\s*(?:(?:стар|бывш|промышленн|жил|пуст|железнодорожн|психиатрическ)[а-я]*\s+){0,3}"
            + _BUILDING,
            _BUILDING + r"\s*(?:заброшен[а-я]{0,6}|авариен|аварийн[а-я]{0,4})",
            forms("недостро", "й я ю ем е и ев ям ями ях", bare=False),
            forms("долгостро", "й я ю ем е и ев ям ями ях", bare=False),
            r"abandoned\s+(?:(?:old|industrial)\s+)?(?:buildings?|structures?|houses?|factories|"
            r"factory|warehouses?|hospitals?|bunkers?|tunnels?|mines?|construction\s+sites?)",
        ),
    ),
    (
        "sexual-venue",
        "В планах нельзя предлагать бордели и притоны",
        (
            forms("бордел", "ь я ю ем е и ей ям ями ях", bare=False),
            forms("бордельн", _ADJ, bare=False),
            forms("притон", _NOUN),
            spelled("нарко") + r"\s*" + forms("притон", _NOUN),
            forms("публичн", _ADJ, bare=False) + r"\s*" + forms("дом", _NOUN),
            forms("дом", _NOUN) + r"\s+терпимости",
            spelled("нарко") + r"\s*" + forms("точк", _FEM, bare=False),
            spelled("нарко") + r"\s*" + forms("лаборатори", "я ю и ей е ям ями ях", bare=False),
            r"brothels?|bordel(?:s|i|ya|e)?|drug\s*dens?|opium\s*dens?",
        ),
    ),
    (
        "restricted-location",
        "Выбери доступное место: закрытые крыши и проникновение на стройки запрещены",
        (
            _CLOSED + r"\s*(?:" + _ROOF + "|" + _SITE + ")",
            "(?:" + _ROOF + "|" + _SITE + r")\s+(?:без\s+доступа|с\s+незаконным\s+проникновением)",
            "(?:" + _ROOF + "|" + _SITE + r")\s+(?:закрыта|закрыты|вход\s+запрещен|охраняется)",
            _INTRUDE + r"\s+(?:(?:тайком|незаконно)\s+)?(?:на|в)\s+(?:" + _ROOF + "|" + _SITE + ")",
            r"незаконное\s+проникновение\s+на\s+(?:" + _ROOF + "|" + _SITE + ")",
            r"(?:залезем|залезть|попадем|попасть)\s+тайком\s+на\s+(?:" + _ROOF + "|" + _SITE + ")",
            r"(?:restricted|closed|off\s+limits)\s+(?:rooftops?|construction\s+sites?)",
            r"(?:trespass|sneak)\s+(?:into|onto)\s+(?:a\s+)?(?:roof|construction\s+site)",
        ),
    ),
    (
        "drugs-topic",
        "В планах нельзя предлагать наркотики или места их употребления",
        ("(?:" + "|".join(_DRUGS) + ")",),
    ),
)
