/** Подпись обнаруженного предмета для интерфейса и PDF. */
const labels: Record<string, string> = {
  'a sofa': 'Диван',
  'an armchair': 'Кресло',
  'a chair': 'Стул',
  'a bar stool': 'Барный стул',
  'a dining table': 'Обеденный стол',
  'a coffee table': 'Журнальный стол',
  'a bedside table': 'Прикроватная тумба',
  'a wardrobe': 'Шкаф',
  'a chest of drawers': 'Комод',
  'a shelving unit': 'Стеллаж',
  'a cabinet': 'Тумба',
  'a bed': 'Кровать',
  'a rug': 'Ковёр',
  'a pendant lamp': 'Подвесной светильник',
  'a floor lamp': 'Торшер',
  'a table lamp': 'Настольная лампа',
  'a framed picture': 'Картина',
  'a mirror': 'Зеркало',
  'a plant': 'Растение',
}

export function detectedObjectLabel(label: string, fallback: string): string {
  return labels[label.trim().toLowerCase()] ?? fallback
}
