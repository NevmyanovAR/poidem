import pytest

from poidem.api.errors import AppError
from poidem.services.plan_content import content_errors, validate_content


@pytest.mark.parametrize(
    "value",
    [
        "Пойдём в стрип-клуб",
        "Стриптиз клуб",
        "В стрипбаре",
        "STRIP CLUB",
        "striptease-clubs",
        "стpип-клyб",
        "с т р и п к л у б",
        "стрип\u200bклуб",
        "На заброшку",
        "зaбр0шкa",
        "заброшенное здание",
        "Заброшенная больница",
        "завод заброшен",
        "заброшенный старый завод",
        "abandoned old factory",
        "abandoned structures",
        "заброшенное сооружение",
        "ЗАБРОШКИ",
    ],
)
def test_forbidden_topics_and_simple_obfuscation(value):
    assert content_errors(title=value)


@pytest.mark.parametrize(
    "value",
    [
        "Кофе и прогулка",
        "Выставка в музее истории завода",
        "Стрипсы и кофе",
        "Комиксы и comic strip",
        "Клуб настольных игр",
        "Заброшенные мысли",
        "Дом культуры",
        "Прогулка по саду",
        "Заброшенный сад на картине",
        "Кафе Стрипласт",
        "Заброшенный заводной механизм на картине",
        "Улица Строителей, 30",
        "Перестройка здания",
    ],
)
def test_word_boundaries_and_unrelated_phrases_are_allowed(value):
    assert content_errors(title=value) == {}


@pytest.mark.parametrize("field", ["title", "description", "place"])
def test_all_three_fields_are_checked_without_echoing_content(field):
    data = {"title": "Кофе", "description": "Встреча", "place": "Кафе"}
    data[field] = "Стрип-клуб секретный адрес"
    with pytest.raises(AppError) as error:
        validate_content(**data)
    assert error.value.code == "PLAN_CONTENT_REJECTED"
    assert field in error.value.fields
    assert "секретный адрес" not in error.value.message


def test_splitting_a_phrase_between_fields_does_not_bypass_the_rule():
    with pytest.raises(AppError):
        validate_content(title="Пойдём в стрип", description="клуб", place="Кафе")


@pytest.mark.parametrize(
    "value",
    [
        "хуй",
        "хуями",
        "похуй",
        "нахуй",
        "хуесос",
        "хуйней",
        "охуевший",
        "хуевыми",
        "пизда",
        "пиздец",
        "пиздоболы",
        "пиздатый",
        "пиздеть",
        "отпиздить",
        "спиздили",
        "ебать",
        "ебаный",
        "ебанутые",
        "еблан",
        "заебали",
        "выебать",
        "разъебал",
        "переебать",
        "доебаться",
        "подъебал",
        "ебашить",
        "наебали",
        "заебись",
        "бля",
        "блять",
        "блядь",
        "бляди",
        "блядскими",
        "сучара",
        "сука",
        "сучкой",
        "мудак",
        "мудаками",
        "мудозвон",
        "мудила",
        "говно",
        "говнюк",
        "срать",
        "обосрался",
        "гандоны",
        "гондон",
        "уебок",
        "долбоеб",
        "долбаеб",
        "пидорас",
        "педик",
        "шлюха",
        "чмошник",
        "мразь",
        "сволочь",
        "идиоты",
        "дебилы",
        "ублюдки",
        "подонки",
        "кретин",
        "FUCK",
        "fuckers",
        "motherfucking",
        "shithead",
        "asshole",
        "bitches",
        "cunt",
        "douchebag",
        "wanker",
        "scumbag",
        "faggot",
        "nigger",
        "БЛЯДЬ",
        "е\u0301бать",
        "е\u200bб\u2060а\u200dть",
        "х у й",
        "п.и.з.д.а",
        "е-б-а-ть",
        "б л я д ь",
        "п и д о р а с",
        "с у к а",
        "х-уй",
        "ху-есос",
        "бл*дь",
        "п*зда",
        "х*й",
        "п**да",
        "сyкa",
        "пiзда",
        "п1зда",
        "xyй",
        "хуууй",
        "сууука",
        "бляяядь",
        "suka",
        "blyad",
        "blyat",
        "pidor",
        "pid0r",
        "nahuy",
        "yebat",
        "ebat",
        "yeblan",
        "pizdec",
        "pizdets",
        "zaebal",
        "f*ck",
        "f4ck",
        "sh1t",
        "b!tch",
        "a$$hole",
    ],
)
def test_extended_profanity_dictionary_and_disguises(value):
    assert content_errors(description=value), value


@pytest.mark.parametrize(
    "value",
    [
        "Я тебя убью",
        "убью тебя",
        "я вас зарежу",
        "тебя точно изобью",
        "Я тебя изнасилую",
        "Давайте убивать людей",
        "убивайте мигрантов",
        "Смерть всем евреям",
        "мусульман нужно уничтожить",
        "женщины должны умереть",
        "геев не люди",
        "давайте ненавидеть армян",
        "I will kill you",
        "kill all immigrants",
        "Продам наркотики",
        "купим наркотиков",
        "Попробуем кокаин",
        "покурим траву",
        "покурить анашу",
        "нюхнем кокс",
        "мефедрон с доставкой",
        "ЛСД в наличии",
        "работа закладчиком",
        "вакансия кладмена",
        "продажа наркотиков",
        "buy cocaine",
        "продам нарк0тики",
        "Секс за деньги",
        "интим за подарки",
        "секс за 5000",
        "сексуальные услуги",
        "услуги эскорта",
        "проститутки на заказ",
        "paid sex",
        "Обманем людей",
        "разведем на деньги",
        "украдем чужие пароли",
        "оформим кредит на чужое имя",
        "создадим фишинговый сайт",
        "заработаем на скаме",
        "ищу дропов",
        "работа дроппером",
        "sell stolen credit cards",
        "Не обсуждаем лекцию, а продам наркотики",
        "Лекция о защите, потом украдем пароли",
        "Не продаю наркотики, но купим кокаин",
        "Лекция о вреде наркотиков. Продам кокаин",
    ],
)
def test_explicit_dangerous_offers_and_threats(value):
    assert content_errors(description=value), value


@pytest.mark.parametrize(
    "value",
    [
        "Подстрахуй меня на скалодроме",
        "Страхуй на трассе",
        "Не психуй, выпьем чаю",
        "Педикюр перед прогулкой",
        "Сукно для бильярда",
        "Сухой закон",
        "Мандарины и чай",
        "Мандельштам и поэзия",
        "Кафе Бляха",
        "Рубля хватит",
        "Употреблять воду полезно",
        "Потребность в общении",
        "Гребля",
        "Хлеб",
        "Небо",
        "Скоблят доски",
        "Соскребать краску",
        "Коктейль в баре",
        "Купить соль и муку для кулинарного урока",
        "Закладка в книге",
        "Погулять по траве",
        "Скорость света",
        "Кафе с доставкой",
        "Продаю билеты в музей",
        "Обычный бар, вино и настольные игры",
        "Лекция о вреде наркотиков",
        "Музей наркополитики",
        "Обсудим наркотики и зависимость",
        "Против насилия",
        "Как распознать мошенничество",
        "Лекция о продаже наркотиков",
        "Не продаю наркотики",
        "Не будем покупать наркотики",
        "Не буду продавать наркотики",
        "Не куплю кокаин",
        "Без наркотиков и угроз",
        "Я тебя не убью",
        "Убью время за настольной игрой",
        "Обсудим фильм Я тебя убью",
        "Защита от фишинговых сайтов",
        "Лекция о сексуальных услугах",
        "История эскорта кораблей",
        "Разговор о сексе и здоровье",
        "Поддержка людей с инвалидностью",
        "ЛГБТ книжный клуб",
        "Гей, лесбиянка, еврей, русский, мусульманин",
        "Gay and lesbian book club",
        "Dick and Jane",
        "Cocktail class",
        "Classic music",
        "Assignment",
        "Scunthorpe",
        "Не только кофе, но и концерт",
        "Мастер класс по анимации",
        "Учимся на ошибках",
    ],
)
def test_extended_dictionary_does_not_ban_neutral_words_or_discussion(value):
    assert content_errors(description=value) == {}, value


@pytest.mark.parametrize("field", ["title", "description", "place"])
@pytest.mark.parametrize("value", ["ебаный", "Продам кокаин", "секс за деньги", "убью тебя"])
def test_new_categories_are_enforced_in_each_field(field, value):
    data = {"title": "Кофе", "description": "Прогулка", "place": "Музей"}
    data[field] = value
    with pytest.raises(AppError) as error:
        validate_content(**data)
    assert error.value.code == "PLAN_CONTENT_REJECTED"
    assert field in error.value.fields
    assert value not in error.value.message


def test_dangerous_offer_split_across_fields_is_rejected():
    with pytest.raises(AppError):
        validate_content(title="Купим", description="кокаин", place="Музей")


def test_safe_sentence_does_not_hide_a_later_threat():
    assert content_errors(description="Не убью тебя. Я тебя зарежу")


@pytest.mark.parametrize(
    "value",
    [
        "Обсуждение слова «хуй»",
        "Этимология слова блядь",
        "Значение термина идиот",
        "Читаем роман «Идиот»",
        "Дискуссия о романе Идиот",
    ],
)
def test_explicit_neutral_term_references_and_book_title(value):
    assert content_errors(description=value) == {}


@pytest.mark.parametrize(
    "value",
    [
        "Значение слова хуй, а ты еблан",
        "Роман Идиот. Я тебя убью",
        "Этимология слова хуй. Продам кокаин",
        "Обсуждение слова сука и купим наркотики",
    ],
)
def test_neutral_reference_does_not_whitewash_other_content(value):
    assert content_errors(description=value)


@pytest.mark.parametrize("value", ["ты тупой", "Ты крыса", "вы козлы", "она шкура", "ты чурбан"])
def test_ambiguous_words_are_blocked_as_direct_insults(value):
    assert content_errors(description=value)


@pytest.mark.parametrize(
    "value",
    [
        "Мастерская: тупой нож и точильный камень",
        "Ферма: козел, овца и свинья",
        "Резьба по деревянным чурбанам",
        "Баран на картине",
        "Петух в деревне",
        "Обсуждение книги о крысе",
        "В мастерской: шкура и краски",
    ],
)
def test_ambiguous_animals_and_objects_are_not_banned_alone(value):
    assert content_errors(description=value) == {}


def test_neutral_english_word_is_not_a_russian_transliteration_and_cannot_hide_abuse():
    assert content_errors(title="Watercolor: color and hue") == {}
    assert content_errors(description="Color, hue and fuck")
