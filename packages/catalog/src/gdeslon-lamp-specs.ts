type LampSpec = {
  externalId: string
  title: string
  sourceUrl: string
  baseCm: { diameter: number } | { width: number; depth: number }
  dimensionsCm: { height?: number; width?: number; depth?: number }
}

// Width and depth describe the whole fixture. Incomplete or inconsistent article
// dimensions stay unset even when the manufacturer specifies the floor base.
const specs: LampSpec[] = [
  {
    externalId: '95754-1581583-11806247623909007000',
    title: 'Торшер Eglo Cawton 43954 цвет плафона/подвески Серый, цвет арматуры Коричневый, Сталь',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/43954',
    baseCm: {
      diameter: 23.0,
    },
    dimensionsCm: {
      height: 134.5,
    },
  },
  {
    externalId: '95754-1594417-5982982568465175000',
    title: 'Торшер Eglo Cremella 99507 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/99507',
    baseCm: {
      diameter: 25.0,
    },
    dimensionsCm: {
      height: 151.0,
      width: 37.0,
      depth: 37.0,
    },
  },
  {
    externalId: '95754-1594175-16073954005762677000',
    title: 'Торшер Eglo Apricale 98285 цвет арматуры Серый',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/98285',
    baseCm: {
      diameter: 22.0,
    },
    dimensionsCm: {
      height: 150.5,
      width: 22.0,
      depth: 22.0,
    },
  },
  {
    externalId: '95754-1594191-3204177565223883000',
    title: 'Торшер Eglo Sabalete 98366 цвет плафона/подвески Белый, цвет арматуры Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/98366',
    baseCm: {
      diameter: 28.0,
    },
    dimensionsCm: {
      height: 155.5,
    },
  },
  {
    externalId: '95754-1581383-12617718053908306000',
    title: 'Торшер Eglo Lacey 43614 цвет плафона/подвески Черный, цвет арматуры Бежевый, Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/43614',
    baseCm: {
      width: 28.0,
      depth: 20.0,
    },
    dimensionsCm: {
      height: 159.5,
    },
  },
  {
    externalId: '95754-1593826-6733701871085435000',
    title: 'Торшер Eglo Pasteri 95164 цвет плафона/подвески Белый, цвет арматуры Никель',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/95164',
    baseCm: {
      diameter: 23.0,
    },
    dimensionsCm: {
      height: 157.5,
      width: 28.0,
      depth: 28.0,
    },
  },
  {
    externalId: '95754-1594082-762870053434654200',
    title: 'Торшер Eglo Viserbella 97647 цвет плафона/подвески Золото, цвет арматуры Бежевый',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/97647',
    baseCm: {
      diameter: 23.0,
    },
    dimensionsCm: {
      height: 158.5,
      width: 28.0,
      depth: 28.0,
    },
  },
  {
    externalId: '95754-1593558-13850505222885341000',
    title: 'Торшер Eglo Nadina 92206 цвет плафона/подвески Белый, цвет арматуры Никель',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/92206',
    baseCm: {
      diameter: 32.0,
    },
    dimensionsCm: {
      height: 195.0,
      width: 179.0,
      depth: 38.0,
    },
  },
  {
    externalId: '95754-1579197-11285697025173477000',
    title:
      'Торшер Eglo Almerimar 390174 цвет плафона/подвески Латунь, Серый, цвет арматуры Латунь, Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/390174',
    baseCm: {
      diameter: 45.0,
    },
    dimensionsCm: {
      height: 180.5,
    },
  },
  {
    externalId: '95754-1581315-3242011917168783400',
    title:
      'Торшер Eglo HORNWOOD 43521 цвет плафона/подвески Коричневый, цвет арматуры Бежевый, Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/43521',
    baseCm: {
      diameter: 23.0,
    },
    dimensionsCm: {
      height: 140.0,
      width: 23.0,
      depth: 23.0,
    },
  },
  {
    externalId: '95754-1581309-3514342522293234000',
    title: 'Торшер Eglo TOWNSHEND 43516 цвет арматуры Коричневый, Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/43516',
    baseCm: {
      diameter: 25.0,
    },
    dimensionsCm: {
      height: 166.5,
    },
  },
  {
    externalId: '95754-1581329-18186343056349176000',
    title: 'Торшер Eglo Redcliffe 43537 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/43537',
    baseCm: {
      diameter: 25.0,
    },
    dimensionsCm: {
      height: 135.5,
    },
  },
  {
    externalId: '95754-1579217-8834672293416782000',
    title:
      'Торшер Eglo Castuera 390295 цвет плафона/подвески Золото, Розовый, цвет арматуры Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/390295',
    baseCm: {
      diameter: 29.5,
    },
    dimensionsCm: {
      height: 172.5,
      width: 30.0,
      depth: 30.0,
    },
  },
  {
    externalId: '95754-1581578-8765760286831002000',
    title: 'Торшер Eglo Oxpark 43945 цвет плафона/подвески Бежевый, цвет арматуры Черный',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/43945',
    baseCm: {
      diameter: 25.0,
    },
    dimensionsCm: {
      height: 146.5,
      width: 42.0,
      depth: 42.0,
    },
  },
  {
    externalId: '95754-1600247-529600505715513340',
    title:
      'Торшер Citilux Мартин CL332961 цвет плафона/подвески Прозрачный, цвет арматуры Коричневый',
    sourceUrl: 'https://citilux.ru/store/cl332961/',
    baseCm: { diameter: 28.5 },
    dimensionsCm: { width: 35, depth: 35, height: 165 },
  },
  {
    externalId: '95754-1601147-18183574109169197000',
    title: 'Торшер Citilux Арчи CL807010 цвет плафона/подвески Белый, цвет арматуры Белый',
    sourceUrl: 'https://citilux.ru/store/cl807010/',
    baseCm: { diameter: 34.5 },
    dimensionsCm: { width: 180, depth: 50, height: 190 },
  },
  {
    externalId: '95754-1601148-4085005305871595500',
    title: 'Торшер Citilux Арчи CL807011 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://citilux.ru/store/cl807011/',
    baseCm: { diameter: 34.5 },
    dimensionsCm: { width: 180, depth: 50, height: 190 },
  },
  {
    externalId: '95754-1600248-9616477030655404000',
    title: 'Торшер Citilux Мартин CL332962 цвет плафона/подвески Бежевый, цвет арматуры Коричневый',
    sourceUrl: 'https://citilux.ru/store/cl332962/',
    baseCm: { diameter: 28.5 },
    dimensionsCm: { width: 35, depth: 35, height: 165 },
  },
  {
    externalId: '95754-1590668-612975568160199400',
    title: 'Торшер Lightstar Loft 765717 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://lightstar-shop.ru/torsher-lightstar-loft-765717',
    baseCm: { diameter: 32 },
    dimensionsCm: {},
  },
  {
    externalId: '116336-765717-2892942192139467000',
    title: 'Торшер Lightstar 765717',
    sourceUrl: 'https://lightstar-shop.ru/torsher-lightstar-loft-765717',
    baseCm: { diameter: 32 },
    dimensionsCm: {},
  },
  {
    externalId: '95754-1591813-2280200031642014200',
    title: 'Торшер Lightstar Croco 815757 цвет плафона/подвески Белый, цвет арматуры Черный',
    sourceUrl: 'https://lightstar-shop.ru/torsher-lightstar-croco-815757',
    baseCm: { diameter: 30 },
    dimensionsCm: { height: 165, width: 32, depth: 32 },
  },
  {
    externalId: '95754-1591812-16329013489859414000',
    title: 'Торшер Lightstar Croco 815753 цвет плафона/подвески Белый, цвет арматуры Латунь',
    sourceUrl: 'https://lightstar-shop.ru/torsher-lightstar-croco-815753',
    baseCm: { diameter: 30 },
    dimensionsCm: { height: 165, width: 32, depth: 32 },
  },
  {
    externalId: '95754-1454952-16627568140959017000',
    title:
      'Торшер Lightstar Torino 615719 цвет плафона/подвески Прозрачный, Сталь, цвет арматуры Сталь',
    sourceUrl: 'https://lightstar-shop.ru/torsher-lightstar-torino-615719',
    baseCm: { diameter: 25 },
    dimensionsCm: { height: 141 },
  },
  {
    externalId: '95754-1455263-5399966341447857000',
    title: 'Торшер Lightstar Loft 765747 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://lightstar-shop.ru/torsher-lightstar-loft-765747',
    baseCm: { diameter: 25 },
    dimensionsCm: { height: 153 },
  },
  {
    externalId: '95754-1464550-1096436217204427800',
    title: 'Торшер Novotech STUD1 359545 цвет плафона/подвески Белый, цвет арматуры Белый',
    sourceUrl: 'https://www.isonex.ru/upload/images_right_names/28469/0/0049992.jpeg',
    baseCm: { width: 45, depth: 30 },
    dimensionsCm: { height: 194.7 },
  },
  {
    externalId: '95754-1464547-10686904316458310000',
    title: 'Торшер Novotech Ledo 359542 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://www.isonex.ru/upload/images_right_names/28466/0/0049989.jpeg',
    baseCm: { diameter: 27 },
    dimensionsCm: { width: 27, depth: 72, height: 135.5 },
  },
  {
    externalId: '95754-1464548-7848349082610873000',
    title: 'Торшер Novotech Ledo 359543 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://www.isonex.ru/upload/images_right_names/28467/0/0049990.jpeg',
    baseCm: { diameter: 24 },
    dimensionsCm: { width: 24, depth: 24, height: 146 },
  },
]

export function gdeslonLampSpec(externalId: string, title: string): LampSpec | undefined {
  return specs.find((spec) => spec.externalId === externalId && spec.title === title)
}
