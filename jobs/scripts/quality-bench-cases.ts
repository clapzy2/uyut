import type { ConceptBrief } from '@uyut/ai'

/** Synthetic briefs; no customer data. One render each, nine paid renders maximum. */
export const qualityBenchCases: Array<{
  id: string
  kind: ConceptBrief['roomKind']
  width: number
  depth: number
  layoutNotes: string
  notes: string
  household: ConceptBrief['household']
}> = [
  {
    id: 'narrow-kitchen',
    kind: 'kitchen',
    width: 180,
    depth: 300,
    layoutNotes:
      'Прямоугольник. Одно обычное окно посередине верхней короткой стены. Вход посередине нижней короткой стены.',
    notes:
      'Кухня для одного человека. Линейный гарнитур, без острова. Складная столешница для завтрака.',
    household: { adults: 1, kids: 0, cookHome: true },
  },
  {
    id: 'small-family-kitchen',
    kind: 'kitchen',
    width: 208,
    depth: 260,
    layoutNotes:
      'Одно окно по центру верхней стены, дверь справа у нижнего угла. Прямоугольная комната.',
    notes: 'Нужны места для двух взрослых и ребёнка. Без острова, проход к двери свободен.',
    household: { adults: 2, kids: 1, cookHome: true },
  },
  {
    id: 'narrow-living',
    kind: 'living',
    width: 240,
    depth: 550,
    layoutNotes:
      'Длинная узкая комната. Одно окно на верхней короткой стене, вход на нижней короткой стене.',
    notes: 'Компактный диван и телевизор. Никакого кухонного гарнитура. Не расширяйте комнату.',
    household: { adults: 2, kids: 0, receiveGuests: true },
  },
  {
    id: 'two-window-living',
    kind: 'living',
    width: 400,
    depth: 500,
    layoutNotes:
      'Прямоугольная комната. Два отдельных обычных окна на верхней стене, между ними простенок. Вход на нижней стене. Панорамного остекления нет.',
    notes: 'Диван, кресло и книжный шкаф. Два окна должны оставаться раздельными.',
    household: { adults: 2, kids: 0 },
  },
  {
    id: 'compact-bedroom',
    kind: 'bedroom',
    width: 280,
    depth: 330,
    layoutNotes:
      'Прямоугольная спальня, одно окно на верхней стене, дверь слева возле нижнего угла.',
    notes:
      'Кровать шириной 140 см, небольшой шкаф, свободный подход. Без дивана и рабочего кабинета.',
    household: { adults: 2, kids: 0 },
  },
  {
    id: 'windowless-bedroom',
    kind: 'bedroom',
    width: 300,
    depth: 350,
    layoutNotes:
      'Прямоугольная комната БЕЗ ОКОН. Один дверной проём по центру нижней стены. Свет только искусственный; не добавлять окна или стеклянные двери.',
    notes:
      'Тест сохранения заданной архитектуры, не рекомендация помещения для проживания. Кровать, шкаф, настенные светильники. Без окон.',
    household: null,
  },
  {
    id: 'khrushchev-family-kitchen',
    kind: 'kitchen',
    width: 215,
    depth: 240,
    layoutNotes:
      'Небольшая прямоугольная кухня. Одно обычное окно по центру верхней стены, под ним радиатор. Одна входная дверь на нижней стене справа.',
    notes:
      'Кухня для двух взрослых и ребёнка. Нужны три места, компактный линейный гарнитур и холодильник. Без острова и без стола в проходе.',
    household: { adults: 2, kids: 1, cookHome: true },
  },
  {
    id: 'balcony-block-kitchen',
    kind: 'kitchen',
    width: 300,
    depth: 340,
    layoutNotes:
      'Прямоугольная кухня. На верхней стене рядом расположены одно обычное окно и одна остеклённая балконная дверь, между ними узкая стойка. Входная дверь находится на нижней стене слева. Балконный блок не панорамный.',
    notes:
      'Кухня для двух взрослых. Сохранить отдельные окно и балконную дверь, оставить свободный проход к балкону. Без острова.',
    household: { adults: 2, kids: 0, cookHome: true },
  },
  {
    id: 'two-opening-kitchen',
    kind: 'kitchen',
    width: 250,
    depth: 390,
    layoutNotes:
      'Вытянутая прямоугольная кухня. Одно окно по центру верхней короткой стены. Один вход на нижней короткой стене и второй открытый дверной проём на правой стене возле верхнего угла.',
    notes:
      'Линейный гарнитур вдоль левой стены. Сохранить прямой свободный маршрут между двумя входами. Три посадочных места, без острова.',
    household: { adults: 2, kids: 1, cookHome: true },
  },
]
