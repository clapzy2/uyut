/**
 * Товары, которым не место в подборе мебели.
 *
 * На живой гостиной владельца лучшим стеллажом четыре раза подряд выходила полка Allen Brau
 * из ванной, а лучшим барным стулом — стульчик для ванной Geralis. Такие товары снимают крупно
 * на белом фоне, поэтому по картинке они выигрывают у настоящей мебели.
 *
 * Правила пишем с границами слов. Грубый поиск по «ванн» выкидывал вазу «Саванна», а по
 * «раковин» — вазу с отделкой раковинами устриц.
 */

/** Марки, которые делают только сантехнику и аксессуары ванной. */
const BATHROOM_BRANDS =
  /(?:^|[\s«"(,])(allen\s*brau|migliore|aquanet|kludi|ridder|geralis|boheme|am\.?pm|grohe|hansgrohe|jacob\s*delafon|cersanit|iddis|wasserkraft|bemeta|fixsen|langberger)(?:$|[\s»")(,.-])/i

/** Прямые указания на ванную и её предметы. */
const BATHROOM_WORDS =
  /(?<![а-яё])(в\s+ванную|для\s+ванной|для\s+ванны|ванной\s+комнаты|унитаз\w*|биде(?![а-яё])|писсуар\w*|умывальник\w*|смесител\w*|душев(?:ая|ой|ую|ые|ых)|полотенцесушител\w*|для\s+полотенец|косметическое\s+зеркало|под\s+раковину)(?![а-яё])/i

/**
 * Зарубежные площадки-перепродажи.
 *
 * Проверяем адрес, а не название. Отсев «в названии нет русских букв» пробовали, и он выкидывал
 * товары Tkano: у этой марки латинские имена моделей, а ковры её — одни из лучших наших совпадений.
 */
const FOREIGN_MARKETPLACES = /(aliexpress|alibaba|temu|joom|shein|wildberries\.eu)/i

export function isBathroomFixture(title: string): boolean {
  return BATHROOM_BRANDS.test(title) || BATHROOM_WORDS.test(title)
}

export function isForeignListing(affiliateUrl: string): boolean {
  return FOREIGN_MARKETPLACES.test(affiliateUrl)
}

/** Оба отсева разом: так их зовут и сборщик, и импорт, и чистка уже собранного. */
export function isNotFurniture(item: { title: string; affiliateUrl: string }): boolean {
  return isBathroomFixture(item.title) || isForeignListing(item.affiliateUrl)
}
