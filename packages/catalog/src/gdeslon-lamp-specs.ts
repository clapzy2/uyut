type LampSpec = {
  externalId: string
  title: string
  sourceUrl: string
  imageUrl?: string
  baseCm?: { diameter: number } | { width: number; depth: number }
  dimensionsCm: { height?: number; width?: number; depth?: number }
}

// Width and depth describe the whole fixture. Incomplete or inconsistent article
// dimensions stay unset even when the manufacturer specifies the floor base.
const specs: LampSpec[] = [
  {
    externalId: '95754-1581583-11806247623909007000',
    title: 'Торшер Eglo Cawton 43954 цвет плафона/подвески Серый, цвет арматуры Коричневый, Сталь',
    sourceUrl: 'https://tools.eglo.com/tds/eng-GB/43954',
    imageUrl: 'https://eglo.ru/upload/imager/59a42128e99dc075c29d8d654d9cde4b.jpg',
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
    imageUrl: 'https://img.lu.ru/index/eglo_99507.jpg',
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
    imageUrl:
      'https://donplafon.ru/upload/iblock/8e8/8u4qjid9gcgayfak104ldtkwgk3ckgr2/torsher_eglo_apricale_98285.jpeg',
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
    imageUrl: 'https://eglo.ru/upload/imager/523ec9f1d7daa73548528d5bef103279.jpg',
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
    imageUrl: 'https://eglo.ru/photo/43614.jpg',
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
    imageUrl: 'https://eglo.ru/upload/imager/199a5847c9f12742f53415d0f7778bfa.jpg',
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
    imageUrl: 'https://eglo.ru/upload/imager/7a2301433d2549ed795f51be43787a0f.jpg',
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
    imageUrl: 'https://eglo.ru/upload/imager/fcf49ae2370d9b903076c7700ae4b01e.jpg',
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
    imageUrl: 'https://eglo.ru/upload/imager/d5562a50d685f929cf52495b8ede97c6.jpg',
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
    imageUrl: 'https://eglo.ru/upload/imager/32ead08d8e9e3adc33e04aa1559fb496.jpg',
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
    imageUrl: 'https://eglo.ru/upload/imager/a625b169327738b7cf9b8dd1536fbede.jpg',
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
    imageUrl: 'https://eglo.ru/upload/imager/2ef8a97181e08b07623666a24a4e49b6.jpg',
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
    imageUrl: 'https://eglo.ru/upload/imager/6a423e78f2e2739040b6795fe5a2372b.jpg',
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
    imageUrl: 'https://eglo.ru/photo/43945.jpg',
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
    imageUrl:
      'https://citilux.ru/api/image?fileId=442380&productId=102828&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    baseCm: { diameter: 28.5 },
    dimensionsCm: { width: 35, depth: 35, height: 165 },
  },
  {
    externalId: '95754-1601147-18183574109169197000',
    title: 'Торшер Citilux Арчи CL807010 цвет плафона/подвески Белый, цвет арматуры Белый',
    sourceUrl: 'https://citilux.ru/store/cl807010/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=744585&productId=97094&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    baseCm: { diameter: 34.5 },
    dimensionsCm: { width: 180, depth: 50, height: 190 },
  },
  {
    externalId: '95754-1601148-4085005305871595500',
    title: 'Торшер Citilux Арчи CL807011 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://citilux.ru/store/cl807011/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=745778&productId=97096&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    baseCm: { diameter: 34.5 },
    dimensionsCm: { width: 180, depth: 50, height: 190 },
  },
  {
    externalId: '95754-1600248-9616477030655404000',
    title: 'Торшер Citilux Мартин CL332962 цвет плафона/подвески Бежевый, цвет арматуры Коричневый',
    sourceUrl: 'https://citilux.ru/store/cl332962/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=318513&productId=102839&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    baseCm: { diameter: 28.5 },
    dimensionsCm: { width: 35, depth: 35, height: 165 },
  },
  {
    externalId: '95754-1590668-612975568160199400',
    title: 'Торшер Lightstar Loft 765717 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://lightstar-shop.ru/torsher-lightstar-loft-765717',
    imageUrl:
      'https://lightstar.ru/image/cache/import_files/8a/8ac2dec71d7511e4b9daf46d04633574_7e558b6869d411e68113c81f66f678b0-1200x630.jpg',
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
    imageUrl:
      'https://lightstar.ru/image/cache/import_files/86/86b438255f0511eb8128c81f66f678b0_9f883b67b2f011eb8137c81f66f678b0-1200x630.jpg',
    baseCm: { diameter: 30 },
    dimensionsCm: { height: 165, width: 32, depth: 32 },
  },
  {
    externalId: '95754-1591812-16329013489859414000',
    title: 'Торшер Lightstar Croco 815753 цвет плафона/подвески Белый, цвет арматуры Латунь',
    sourceUrl: 'https://lightstar-shop.ru/torsher-lightstar-croco-815753',
    imageUrl: 'https://cdn.basicdecor.ru/files/media/product_photos/ec/1938285/big/815753_11.jpg',
    baseCm: { diameter: 30 },
    dimensionsCm: { height: 165, width: 32, depth: 32 },
  },
  {
    externalId: '95754-1454952-16627568140959017000',
    title:
      'Торшер Lightstar Torino 615719 цвет плафона/подвески Прозрачный, Сталь, цвет арматуры Сталь',
    sourceUrl: 'https://lightstar.ru/615719',
    imageUrl:
      'https://lightstar.ru/image/cache/import_files/e7/e709e689b92a11ef80c0c81f66f678af_acccc42a784a11f080c0c81f66f678af-1200x630.jpg',
    baseCm: { diameter: 25 },
    dimensionsCm: { width: 25, depth: 25, height: 141 },
  },
  {
    externalId: '95754-1455263-5399966341447857000',
    title: 'Торшер Lightstar Loft 765747 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://lightstar.ru/765747',
    imageUrl:
      'https://lightstar.ru/image/cache/import_files/1f/1f26c962b92111ef80c0c81f66f678af_b4b32b2c79d511f080c0c81f66f678af-1200x630.jpg',
    baseCm: { diameter: 25 },
    dimensionsCm: { width: 25, height: 153 },
  },
  {
    externalId: '95754-1464550-1096436217204427800',
    title: 'Торшер Novotech STUD1 359545 цвет плафона/подвески Белый, цвет арматуры Белый',
    sourceUrl: 'https://www.isonex.ru/upload/images_right_names/28469/0/0049992.jpeg',
    imageUrl: 'https://img.divine-light.ru/1/528/001528019_256_256.jpg',
    baseCm: { width: 45, depth: 30 },
    dimensionsCm: { height: 194.7 },
  },
  {
    externalId: '95754-1464547-10686904316458310000',
    title: 'Торшер Novotech Ledo 359542 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://www.isonex.ru/upload/images_right_names/28466/0/0049989.jpeg',
    imageUrl: 'https://img.divine-light.ru/1/578/001578620_256_256.jpg',
    baseCm: { diameter: 27 },
    dimensionsCm: { width: 27, depth: 72, height: 135.5 },
  },
  {
    externalId: '95754-1464548-7848349082610873000',
    title: 'Торшер Novotech Ledo 359543 цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://www.isonex.ru/upload/images_right_names/28467/0/0049990.jpeg',
    imageUrl: 'https://img.divine-light.ru/1/578/001578614_256_256.jpg',
    baseCm: { diameter: 24 },
    dimensionsCm: { width: 24, depth: 24, height: 146 },
  },
  {
    externalId: '95754-1599667-11931080404202879000',
    title: 'Торшер Citilux Томми CL102930 цвет плафона/подвески Светло-серый, цвет арматуры Хром',
    sourceUrl: 'https://citilux.ru/store/cl102930/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=737607&productId=96788&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 160, depth: 30, width: 30 },
  },
  {
    externalId: '95754-1599668-15654640306091383000',
    title: 'Торшер Citilux Томми CL102931 цвет плафона/подвески Прозрачный, цвет арматуры Хром',
    sourceUrl: 'https://citilux.ru/store/cl102931/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=737907&productId=96778&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 160, depth: 30, width: 30 },
  },
  {
    externalId: '95754-1599669-14053212049606900000',
    title: 'Торшер Citilux Томми CL102933 цвет плафона/подвески Бежевый, цвет арматуры Бронза',
    sourceUrl: 'https://citilux.ru/store/cl102933/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=693799&productId=96798&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 160, depth: 30, width: 30 },
  },
  {
    externalId: '95754-1599724-4171254188527176000',
    title: 'Торшер Citilux Берта CL126922 цвет плафона/подвески Белый, цвет арматуры Коричневый',
    sourceUrl: 'https://citilux.ru/store/cl126922/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=112832&productId=15796&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 156, depth: 22, width: 28 },
  },
  {
    externalId: '95754-1456016-13300750928731515000',
    title:
      'Торшер Citilux ORTON CL202933 цвет плафона/подвески Светло-серый, Бежевый, цвет арматуры Черный',
    sourceUrl: 'https://citilux.ru/store/cl202933/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=672373&productId=119362&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 172, depth: 45, width: 45 },
  },
  {
    externalId: '95754-1600249-13182841334259694000',
    title:
      'Торшер Citilux Мартин CL332991 цвет плафона/подвески Прозрачный, цвет арматуры Коричневый',
    sourceUrl: 'https://citilux.ru/store/cl332991/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=200914&productId=15372&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 170, depth: 40, width: 40 },
  },
  {
    externalId: '95754-1600250-17357118070640278000',
    title: 'Торшер Citilux Мартин CL332992 цвет плафона/подвески Бежевый, цвет арматуры Коричневый',
    sourceUrl: 'https://citilux.ru/store/cl332992/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=319506&productId=102838&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 170, depth: 40, width: 40 },
  },
  {
    externalId: '95754-1600459-17330086723483870000',
    title: 'Торшер Citilux Ровена CL427910 цвет плафона/подвески Белый, цвет арматуры Белый',
    sourceUrl: 'https://citilux.ru/store/cl427910/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=443379&productId=14851&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 178, depth: 40, width: 40 },
  },
  {
    externalId: '95754-1600545-11055369386033768000',
    title: 'Торшер Citilux Аврора CL463910 цвет плафона/подвески Белый, цвет арматуры Хром',
    sourceUrl: 'https://citilux.ru/store/cl463910/',
    imageUrl:
      'https://citilux.ru/api/image?fileId=367328&productId=14239&fieldName=detailPicture&w=558&h=558&format=webp&q=90',
    dimensionsCm: { height: 158, depth: 40, width: 40 },
  },
  {
    externalId: '95754-1573964-5749320479754701000',
    title: 'Торшер Globo Bailey 24662 цвет плафона/подвески Белый, цвет арматуры Хром',
    sourceUrl: 'https://www.globo-lighting.com/en/bailey-24662',
    imageUrl: 'https://www.globo-lighting.com/media/3a/e5/c0/1716153934/24662_a.webp?ts=1781321095',
    dimensionsCm: { width: 14, depth: 14, height: 119 },
  },
  {
    externalId: '95754-1573969-17641737916743424000',
    title: 'Торшер Globo Anita 24703SR цвет плафона/подвески Коричневый, цвет арматуры Медь',
    sourceUrl: 'https://www.globo-lighting.com/en/anita-24703SR',
    imageUrl: 'https://www.globo-lighting.com/media/f2/6e/87/1716086673/24703SR.webp?ts=1781436946',
    dimensionsCm: { width: 23, depth: 50, height: 155 },
  },
  {
    externalId: '95754-1573868-1303370921062868000',
    title: 'Торшер Globo Gianna 24099SB цвет плафона/подвески Черный, цвет арматуры Черный',
    sourceUrl: 'https://globo-lighting.ba/proizvod/podna-lampa-gianna/',
    imageUrl:
      'https://voltonov.ru/system/product_images/attachments/64a2/8b82/cb77/7d36/a57c/c833/main/globo-24099sb.jpg',
    dimensionsCm: { width: 20, depth: 47.7, height: 139 },
  },
  {
    externalId: '95754-1609358-8507826857238873000',
    title:
      'Торшер Lussole LSP-0590 цвет плафона/подвески Бежевый, цвет арматуры Коричневый, Черный',
    sourceUrl: 'https://www.lampadia.ru/product/torsher-lsp-0590-lussole/',
    imageUrl: 'https://electrobufet.ru/pictures/product/middle/79706_middle.jpg',
    dimensionsCm: { width: 46, depth: 46, height: 153 },
  },
  {
    externalId: '95754-1454653-15228172501580095000',
    title: 'Торшер Arlight OTTORI 58485 высота 1252 мм',
    sourceUrl: 'https://arlight.ru/catalog/product/058485/',
    imageUrl: 'https://arlight.ru/upload/products/E7CD9756F890794C9FDC527D756B2F45.jpg',
    baseCm: { diameter: 21 },
    dimensionsCm: { depth: 24.7, width: 21, height: 125.2 },
  },
  {
    externalId: '95754-1454655-7239312851140980000',
    title: 'Торшер Arlight VERDI 58488 высота 1465 мм',
    sourceUrl: 'https://arlight.ru/catalog/product/058488/',
    imageUrl: 'https://arlight.ru/upload/products/1A98331E629EEC4DB76E752C24A6A7D8.jpg',
    baseCm: { diameter: 25 },
    dimensionsCm: { depth: 37.3, width: 25, height: 146.5 },
  },
  {
    externalId: '95754-1572433-18092726708121885000',
    title:
      'Торшер Eurosvet Allata 2045/3F хром/белый торшер цвет плафона/подвески Белый, Прозрачный, цвет арматуры Хром',
    sourceUrl:
      'https://eurosvet.ru/catalog/torsheri/torsher-s-prozrachnym-abazhurom-2045-3f-khrom-belyy-00000046063',
    imageUrl:
      'https://cdn.minimir.ru/images/catalog/torsher-s-prozrachnym-abazhurom-2045-3f-khrom-belyy-00000046063_0001.jpg',
    dimensionsCm: { depth: 43, width: 43, height: 155 },
  },
  {
    externalId: '95644-18570423-8618038675254193000',
    title: 'Торшер светодиодный Camelion KD-795 цвет белый',
    sourceUrl: 'https://petrovich.ru/product/993348/',
    baseCm: { diameter: 21 },
    dimensionsCm: { depth: 25, width: 21, height: 150 },
  },
  {
    externalId: '95644-18570431-9063946197334984000',
    title: 'Торшер светодиодный Camelion KD-795 цвет чёрный',
    sourceUrl:
      'https://www.vseinstrumenti.ru/product/napolnyj-svetilnik-chernyj-led-torsher-6vt-230v-sensornoe-vklyuchenie-4-urovnya-yarkosti-4000k-camelion-kd-795-c02-12495-805758/',
    baseCm: { diameter: 21 },
    dimensionsCm: { depth: 25, width: 21, height: 150 },
  },
  {
    externalId: '118488-578055-837771993042939500',
    title: 'Торшер',
    sourceUrl: 'https://odnajdy.ru/product/torsher-derevo-krashenie-19579/',
    dimensionsCm: { width: 47, depth: 47, height: 143 },
  },
  {
    externalId: '118488-495071-10434093750997776000',
    title: 'Лампа напольная (торшер)',
    sourceUrl: 'https://odnajdy.ru/product/lampa-napolnaya-torsher-8946/',
    dimensionsCm: { width: 59, depth: 59, height: 159.5 },
  },
  {
    externalId: '95754-1454431-17207002364087716000',
    title: 'Торшер Arlight LUNAR 56252 высота 1890 мм',
    sourceUrl: 'https://arlight.ru/catalog/product/056252/',
    imageUrl: 'https://arlight.ru/upload/products/87FFCC281FE6BE4F9E1A8F5D152F8DB7.jpg',
    dimensionsCm: { height: 189 },
  },
  {
    externalId: '95754-1454432-8824861130809120000',
    title: 'Торшер Arlight LUNAR 56253 высота 1890 мм',
    sourceUrl: 'https://arlight.ru/catalog/product/056253/',
    imageUrl: 'https://arlight.ru/upload/products/A1E3765B20CEEA4AAB0D65D58217C00E.jpg',
    dimensionsCm: { height: 189 },
  },
  {
    externalId: '95754-1453383-5852857690636445000',
    title: 'Торшер Nowodvorski Lago 11676 высота 1630 мм',
    sourceUrl: 'https://solislux.eu/site_files/e2f98346e977b9373798e914f5324301.pdf#page=86',
    imageUrl: 'https://img.divine-light.ru/1/565/001565405_800_800.jpg',
    baseCm: { diameter: 34 },
    dimensionsCm: { width: 46, height: 163, depth: 46 },
  },
  {
    externalId: '105470-11021035-8170698035002363000',
    title: 'Торшер TR97662, 1хE27, 40 Вт, 145×14 см, зелёный',
    sourceUrl:
      'https://www.ambrella.biz/catalog/dekorativnyy_svet/napolnye_svetilniki_torsher/TR97662/',
    dimensionsCm: { width: 22, height: 145 },
  },
  {
    externalId: '105470-11021037-12584757854605599000',
    title: 'Торшер TR97693, 1хE27, 40 Вт, 154×15 см, зелёный',
    sourceUrl:
      'https://www.ambrella.biz/catalog/dekorativnyy_svet/napolnye_svetilniki_torsher/TR97693/',
    dimensionsCm: { width: 22, height: 154 },
  },
  {
    externalId: '116336-we10706105-617393368287883000',
    title: 'Торшер Wertmark WE107.06.105',
    sourceUrl: 'https://wertmark-shop.ru/shop/floor-lamps/2367/',
    dimensionsCm: { width: 40, height: 167 },
  },
]

export function gdeslonLampSpec(externalId: string, title: string): LampSpec | undefined {
  return specs.find((spec) => spec.externalId === externalId && spec.title === title)
}
