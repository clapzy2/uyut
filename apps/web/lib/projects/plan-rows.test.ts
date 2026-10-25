import type { PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import type { NativeRoomScheduleReport } from './plan-native-room-number-links'
import {
  appendSourcePlanRow,
  appendUnlabeledOutdoorPlanRow,
  appendVerifiedOutdoorScheduleRows,
  areaCheck,
  clearUnreviewedPlanAxes,
  type PlanRow,
  patchPlanRow,
  planRows,
  totalAreaCheck,
} from './plan-rows'

describe('source axis acknowledgments', () => {
  const row = planRows({
    readAt: '2026-10-08',
    rooms: [{ name: 'Гостиная', kind: 'living', widthCm: 600, depthCm: 320 }],
  })[0]
  if (!row) throw new Error('Missing fixture')

  it('never acknowledges model-populated or previously transferred dimensions automatically', () => {
    expect(row.widthReviewed).not.toBe(true)
    expect(row.depthReviewed).not.toBe(true)
  })

  it('invalidates only the edited axis and both axes after a room-scope edit', () => {
    const reviewed = { ...row, widthReviewed: true, depthReviewed: true }
    expect(patchPlanRow(reviewed, { width: '320' })).toMatchObject({
      widthReviewed: false,
      depthReviewed: true,
    })
    expect(patchPlanRow(reviewed, { depth: '600' })).toMatchObject({
      widthReviewed: true,
      depthReviewed: false,
    })
    for (const patch of [
      { name: 'Кухня' },
      { kind: 'kitchen' as const },
      { spaceKind: 'balcony' as const },
      { sourceNumber: 2 },
      { roomId: 'different-room' },
    ]) {
      expect(patchPlanRow(reviewed, patch)).toMatchObject({
        widthReviewed: false,
        depthReviewed: false,
      })
    }
    expect(patchPlanRow(reviewed, { wish: 'Диван' })).toMatchObject({
      widthReviewed: true,
      depthReviewed: true,
    })
  })

  it('clears unreviewed axes only after explicit omission, keeping reviewed values', () => {
    expect(clearUnreviewedPlanAxes(row)).toMatchObject({ width: '', depth: '' })
    expect(clearUnreviewedPlanAxes({ ...row, widthReviewed: true })).toMatchObject({
      width: '600',
      depth: '',
    })
  })
})

describe('unowned PDF dimension candidates', () => {
  const reading: PlanReading = {
    readAt: '2026-10-20',
    rooms: [{ name: 'Прихожая', kind: 'living', sourceNumber: 1, widthCm: 310 }],
  }

  it('keeps a candidate visible without filling or acknowledging a room measurement', () => {
    const [row] = planRows(reading, [], true)
    expect(row).toMatchObject({ width: '', widthCandidate: '310', depth: '' })
    expect(row?.widthReviewed).not.toBe(true)
    expect(planRows(reading)[0]?.width).toBe('310')
  })

  it('withdraws a candidate when the reviewer changes its room identity', () => {
    const [row] = planRows(reading, [], true)
    if (!row) throw new Error('Missing candidate')
    expect(patchPlanRow(row, { sourceNumber: 4 })).toMatchObject({
      width: '',
      widthCandidate: undefined,
      widthReviewed: false,
    })
    expect(patchPlanRow(row, { width: '310' })).toMatchObject({
      width: '310',
      widthReviewed: false,
    })
    expect(
      patchPlanRow(patchPlanRow(row, { width: '310' }), { name: 'Жилая комната' }),
    ).toMatchObject({
      width: '',
      widthCandidate: undefined,
      widthReviewed: false,
    })
  })
})

describe('source architecture acknowledgment', () => {
  const row = planRows({
    readAt: '2026-10-17',
    confirmedAt: '2026-10-17',
    rooms: [{ name: 'Кухня', kind: 'kitchen', layoutNotes: 'Окно сверху, вход снизу.' }],
  })[0]
  if (!row) throw new Error('Missing fixture')

  it('never treats AI text or reopening a saved reading as a new deliberate review', () => {
    expect(row.layoutNotes).toBe('Окно сверху, вход снизу.')
    expect(row.layoutNotesReviewed).not.toBe(true)
  })

  it('withdraws the review on text or room changes, not on unrelated wishes or dimensions', () => {
    const reviewed = { ...row, layoutNotesReviewed: true }
    for (const patch of [
      { layoutNotes: 'Окно справа.' },
      { name: 'Детская' },
      { kind: 'kid' as const },
      { sourceNumber: 3 },
      { roomId: 'different-room' },
    ]) {
      expect(patchPlanRow(reviewed, patch).layoutNotesReviewed).toBe(false)
    }
    expect(patchPlanRow(reviewed, { wish: 'Стол', width: '230' }).layoutNotesReviewed).toBe(true)
    expect(patchPlanRow(row, { layoutNotesReviewed: true }).layoutNotesReviewed).toBe(true)
  })
})

describe('adding missing schedule rows', () => {
  it('retains decimal source identity without assigning the parent measurements', () => {
    const parent = appendSourcePlanRow([], { name: 'Спальня', sourceNumber: 3 }, 'bedroom')
    expect(parent).not.toBeNull()
    if (!parent) throw new Error('Missing parent source row fixture')
    const rows = appendSourcePlanRow(parent, { name: 'Гардеробная', sourceNumber: 3.1 }, 'utility')
    expect(rows?.map((row) => row.sourceNumber)).toEqual([3, 3.1])
    expect(rows?.[1]).toMatchObject({ width: '', depth: '', area: '', ceiling: '', include: false })
    expect(
      appendSourcePlanRow([], { name: 'Гардеробная', sourceNumber: 3.1001 }, 'utility'),
    ).toBeNull()
  })
  it('adds only a numbered identity and leaves every measurement empty', () => {
    const rows = appendSourcePlanRow([], { name: 'Спальня 6', sourceNumber: 6 }, 'bedroom')
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Спальня 6',
        sourceNumber: 6,
        kind: 'bedroom',
        include: false,
        width: '',
        depth: '',
        area: '',
        ceiling: '',
        unsupported: false,
      }),
    ])
    expect(rows?.[0]).not.toHaveProperty('roomId')
  })

  it('retains utility and bathroom rows without turning them into a living room for furniture', () => {
    expect(
      appendSourcePlanRow([], { name: 'Лоджия', sourceNumber: 9 }, 'utility')?.[0],
    ).toMatchObject({
      spaceKind: 'loggia',
      include: false,
      unsupported: true,
      unsupportedReason: 'utility',
    })
    expect(
      appendSourcePlanRow([], { name: 'Санузел', sourceNumber: 3 }, 'bath')?.[0],
    ).toMatchObject({ kind: 'bath', include: false, unsupportedReason: 'kind' })
  })

  it('rejects duplicate identities, invalid rows and exceeding the save bound', () => {
    const row = appendSourcePlanRow([], { name: 'Спальня', sourceNumber: 6 }, 'bedroom')?.[0]
    if (!row) throw new Error('Missing fixture')
    expect(
      appendSourcePlanRow([row], { name: 'Другое название', sourceNumber: 6 }, 'living'),
    ).toBeNull()
    expect(appendSourcePlanRow([], { name: '', sourceNumber: 6 }, 'bedroom')).toBeNull()
    expect(appendSourcePlanRow([], { name: 'Комната', sourceNumber: 0 }, 'bedroom')).toBeNull()
    expect(
      appendSourcePlanRow(
        Array.from({ length: 20 }, () => row),
        { name: 'Комната', sourceNumber: 7 },
        'bedroom',
      ),
    ).toBeNull()
  })
})

describe('checked native outdoor schedule prefill', () => {
  const schedule: NativeRoomScheduleReport = {
    status: 'draft',
    refusalReason: null,
    rows: [
      {
        sourceNumber: 1,
        name: 'Помещение',
        documentaryAreaM2: 40.13,
        numberLabelId: 'native-text-20',
        nameLabelId: 'native-text-24',
        areaLabelId: 'native-text-28',
        markerStatus: 'unobserved',
        markerLabelIds: [],
      },
      {
        sourceNumber: 2,
        name: 'Балкон 01',
        documentaryAreaM2: 4.75,
        numberLabelId: 'native-text-21',
        nameLabelId: 'native-text-25',
        areaLabelId: 'native-text-29',
        markerStatus: 'unobserved',
        markerLabelIds: [],
      },
      {
        sourceNumber: 3,
        name: 'Балкон 02',
        documentaryAreaM2: 3.34,
        numberLabelId: 'native-text-22',
        nameLabelId: 'native-text-26',
        areaLabelId: 'native-text-30',
        markerStatus: 'unobserved',
        markerLabelIds: [],
      },
    ],
    unlistedMarkerLabelIds: [],
  }

  it('adds only missing printed balconies as unselected documentary rows', () => {
    const existing = appendSourcePlanRow([], { name: 'Помещение', sourceNumber: 1 }, 'living') ?? []
    const result = appendVerifiedOutdoorScheduleRows(existing, schedule)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe(existing[0])
    expect(result.slice(1)).toEqual([
      expect.objectContaining({
        sourceNumber: 2,
        name: 'Балкон 01',
        spaceKind: 'balcony',
        area: '4,75',
        include: false,
        unsupported: true,
        width: '',
        depth: '',
        ceiling: '',
      }),
      expect.objectContaining({
        sourceNumber: 3,
        name: 'Балкон 02',
        spaceKind: 'balcony',
        area: '3,34',
        include: false,
      }),
    ])
    expect(appendVerifiedOutdoorScheduleRows(result, schedule)).toBe(result)
    expect(existing).toHaveLength(1)
  })

  it('never overwrites a row already in the form or imports an ambiguous table', () => {
    const existing =
      appendSourcePlanRow([], { name: 'Моя лоджия', sourceNumber: 2 }, 'utility') ?? []
    expect(appendVerifiedOutdoorScheduleRows(existing, schedule)[0]).toBe(existing[0])
    const named = appendSourcePlanRow([], { name: 'Балкон 01', sourceNumber: 6 }, 'utility') ?? []
    expect(appendVerifiedOutdoorScheduleRows(named, schedule)).toHaveLength(2)
    expect(appendVerifiedOutdoorScheduleRows(named, schedule)[0]).toBe(named[0])
    expect(appendVerifiedOutdoorScheduleRows(existing, { ...schedule, status: 'unresolved' })).toBe(
      existing,
    )
    expect(
      appendVerifiedOutdoorScheduleRows(existing, { ...schedule, refusalReason: 'unverified' }),
    ).toBe(existing)
    expect(
      appendVerifiedOutdoorScheduleRows(existing, {
        ...schedule,
        rows: [...schedule.rows, schedule.rows[1] as NativeRoomScheduleReport['rows'][number]],
      }),
    ).toBe(existing)
    const repeatedName = structuredClone(schedule)
    if (!repeatedName.rows[2]) throw new Error('Missing schedule fixture')
    repeatedName.rows[2].name = 'Балкон 01'
    expect(appendVerifiedOutdoorScheduleRows(existing, repeatedName)).toBe(existing)
    repeatedName.rows[2].name = 'Балкон 1'
    expect(appendVerifiedOutdoorScheduleRows(existing, repeatedName)).toBe(existing)
  })

  it('preserves manually added balconies rather than guessing which numbered row they represent', () => {
    const manual = appendUnlabeledOutdoorPlanRow([], 'balcony')
    if (!manual) throw new Error('Missing manual balcony fixture')
    const row = manual[0]
    if (!row) throw new Error('Missing manual balcony row')
    manual[0] = { ...row, area: '2,0', wish: 'Сохранить ограждение' }
    expect(appendVerifiedOutdoorScheduleRows(manual, schedule)).toBe(manual)
    expect(manual[0]).toMatchObject({ area: '2,0', wish: 'Сохранить ограждение' })
  })

  it('matches zero-padded balcony labels without replacing user measurements', () => {
    const existing = appendSourcePlanRow([], { name: 'Балкон 1', sourceNumber: 6 }, 'utility')
    if (!existing) throw new Error('Missing numbered balcony fixture')
    const row = existing[0]
    if (!row) throw new Error('Missing numbered balcony row')
    existing[0] = { ...row, area: '4,8', wish: 'Сохранить плитку' }
    const result = appendVerifiedOutdoorScheduleRows(existing, schedule)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(existing[0])
    expect(result[0]).toMatchObject({ area: '4,8', wish: 'Сохранить плитку' })
    expect(result[1]).toMatchObject({ name: 'Балкон 02', sourceNumber: 3 })
  })

  it('holds the entire batch when a printed area is invalid or capacity is exhausted', () => {
    const empty: PlanRow[] = []
    const invalid = structuredClone(schedule)
    if (!invalid.rows[1]) throw new Error('Missing schedule fixture')
    invalid.rows[1].documentaryAreaM2 = 0
    expect(appendVerifiedOutdoorScheduleRows(empty, invalid)).toBe(empty)
    const row = appendSourcePlanRow([], { name: 'Комната', sourceNumber: 4 }, 'living')?.[0]
    if (!row) throw new Error('Missing row fixture')
    const existing = Array.from({ length: 19 }, () => row)
    expect(appendVerifiedOutdoorScheduleRows(existing, schedule)).toBe(existing)
  })
})

describe('unlabeled outdoor zones', () => {
  it('adds a separate unmeasured balcony without inventing a source number or area', () => {
    const rows = appendUnlabeledOutdoorPlanRow([], 'balcony')
    expect(rows?.[0]).toMatchObject({
      name: 'Балкон',
      spaceKind: 'balcony',
      include: false,
      unsupportedReason: 'utility',
      width: '',
      depth: '',
      area: '',
    })
    expect(rows?.[0]).not.toHaveProperty('sourceNumber')
    expect(appendUnlabeledOutdoorPlanRow(rows ?? [], 'balcony')?.[1]?.name).toBe('Балкон 2')
    const first = rows?.[0]
    if (!first) throw new Error('Missing balcony fixture')
    expect(
      appendUnlabeledOutdoorPlanRow(
        Array.from({ length: 20 }, () => first),
        'loggia',
      ),
    ).toBeNull()
  })

  it('keeps the interior area check when a balcony has no printed area', () => {
    expect(
      totalAreaCheck(
        [
          { area: '14,9' },
          { area: '5,4' },
          { area: '5,8' },
          { area: '2,7' },
          { area: '', spaceKind: 'balcony' },
        ],
        28.8,
      ),
    ).toMatchObject({ agrees: true, sum: '28,8' })
  })

  it('compares the complete documentary inventory when the total includes a loggia', () => {
    const rows = [
      { area: '6,15' },
      { area: '19,44' },
      { area: '4,17', spaceKind: 'loggia' as const },
      { area: '14,19' },
      { area: '4,79' },
    ]
    expect(totalAreaCheck(rows, 48.74)).toMatchObject({ agrees: true, sum: '48,74' })
    expect(totalAreaCheck(rows, 44.57)?.agrees).toBe(true)
    expect(totalAreaCheck(rows, 60)?.agrees).toBe(false)
    expect(
      totalAreaCheck(
        rows.map((row, index) => (index === 0 ? { ...row, area: '' } : row)),
        48.74,
      ),
    ).toBeNull()
  })

  it('reopens a balcony as a utility zone rather than furniture room', () => {
    expect(
      planRows(reading([{ name: 'Балкон', kind: 'living', spaceKind: 'balcony' }]))[0],
    ).toMatchObject({ spaceKind: 'balcony', include: false, unsupportedReason: 'utility' })
  })
})

function reading(rooms: PlanReading['rooms']): PlanReading {
  return { ceilingCm: 270, rooms, readAt: '2026-09-12T00:00:00.000Z' }
}

describe('planRows', () => {
  it('показывает подпись без размеров, но не переносит её в комнаты автоматически', () => {
    const [row] = planRows(reading([{ name: 'Спальня', kind: 'bedroom', nameOnlyCandidate: true }]))
    expect(row).toMatchObject({
      include: false,
      unsupported: false,
      width: '',
      depth: '',
      area: '',
    })
  })

  it('не переносит спорный второй балкон из растрового чтения', () => {
    const [row] = planRows(
      reading([
        {
          name: 'Балкон 2',
          kind: 'living',
          spaceKind: 'balcony',
          utility: true,
          nameOnlyCandidate: true,
        },
      ]),
    )
    expect(row).toMatchObject({
      include: false,
      spaceKind: 'balcony',
      area: '',
      width: '',
      depth: '',
    })
  })

  it('передаёт архитектуру в редактируемое поле, старый план оставляет его пустым', () => {
    const [row, legacy] = planRows(
      reading([
        { name: 'Кухня', kind: 'kitchen', layoutNotes: 'Окно снизу, дверь слева' },
        { name: 'Гостиная', kind: 'living' },
      ]),
    )
    expect(row?.layoutNotes).toBe('Окно снизу, дверь слева')
    expect(legacy?.layoutNotes).toBe('')
  })
  it('числа становятся текстом полей, площадь через запятую', () => {
    const [row] = planRows(
      reading([{ name: 'Гостиная', kind: 'living', widthCm: 383, depthCm: 425, areaM2: 16.3 }]),
    )
    expect(row).toMatchObject({ include: true, width: '383', depth: '425', area: '16,3' })
    // Желание человек пишет сам: с плана его взять неоткуда
    expect(row?.wish).toBe('')
  })

  it('чего не прочитали, то пустое поле, а не ноль', () => {
    const [row] = planRows(reading([{ name: 'Кухня', kind: 'kitchen', widthCm: 245 }]))
    expect(row?.depth).toBe('')
    expect(row?.area).toBe('')
  })

  it('санузел показываем, но снятым: таких комнат сервис пока не делает', () => {
    const [row] = planRows(reading([{ name: 'Санузел', kind: 'bath', widthCm: 168 }]))
    expect(row?.unsupported).toBe(true)
    expect(row?.include).toBe(false)
  })

  it('несходящуюся строку передаём дальше с пометкой', () => {
    const [row] = planRows(
      reading([
        {
          name: 'Спальня',
          kind: 'bedroom',
          widthCm: 290,
          depthCm: 425,
          areaM2: 25,
          suspicious: true,
        },
      ]),
    )
    expect(row?.suspicious).toBe(true)
    expect(row?.include).toBe(true)
  })

  it('комнату из анкеты план дополняет, а не задваивает', () => {
    const rows = planRows(
      reading([
        { name: 'Гостиная', kind: 'living', widthCm: 383 },
        { name: 'Спальня', kind: 'bedroom', widthCm: 290 },
      ]),
      [{ id: 'r1', name: 'Гостиная', kind: 'living', notes: null }],
    )
    expect(rows[0]?.roomId).toBe('r1')
    expect(rows[0]?.roomName).toBe('Гостиная')
    expect(rows[1]?.roomId).toBeUndefined()
  })

  it('повторное чтение того же плана не заводит вторую «Гостиную»', () => {
    const rows = planRows(reading([{ name: 'Гостиная', kind: 'living', widthCm: 383 }]), [
      { id: 'r1', name: 'Гостиная', kind: 'living', notes: null },
    ])
    expect(rows[0]?.roomId).toBe('r1')
  })

  it('«Спальня 1» из серии дома — та же спальня, что и «Спальня» с плана', () => {
    const rows = planRows(reading([{ name: 'Спальня', kind: 'bedroom', widthCm: 290 }]), [
      { id: 'r1', name: 'Спальня 1', kind: 'bedroom', notes: null },
    ])
    expect(rows[0]?.roomId).toBe('r1')
  })

  it('прихожая не забирает себе гостиную: у них общий тип, но разные названия', () => {
    const rows = planRows(
      reading([
        { name: 'Прихожая', kind: 'living', widthCm: 120, depthCm: 700 },
        { name: 'Гостиная', kind: 'living', widthCm: 383, depthCm: 425 },
      ]),
      [{ id: 'r1', name: 'Гостиная', kind: 'living', notes: null }],
    )
    expect(rows[0]?.roomId).toBeUndefined()
    expect(rows[1]?.roomId).toBe('r1')
  })

  it('поле желания открывается с тем, что человек уже писал про эту комнату', () => {
    const rows = planRows(reading([{ name: 'Гостиная', kind: 'living', widthCm: 383 }]), [
      {
        id: 'r1',
        name: 'Гостиная',
        kind: 'living',
        notes: 'телевизор и батарею оставить',
      },
    ])
    expect(rows[0]?.wish).toBe('телевизор и батарею оставить')
  })

  it('не выбирает первую из двух исходных спален для единственной комнаты проекта', () => {
    const rows = planRows(
      reading([
        { name: 'Спальня', kind: 'bedroom', sourceNumber: 3, widthCm: 290 },
        { name: 'Спальня', kind: 'bedroom', sourceNumber: 6, widthCm: 310 },
      ]),
      [{ id: 'r1', name: 'Спальня', kind: 'bedroom', notes: null }],
    )
    expect(rows.every((row) => row.roomId === undefined && row.ambiguous === true)).toBe(true)
    expect(rows.map((row) => row.sourceNumber)).toEqual([3, 6])
    expect(rows.map((row) => row.width)).toEqual(['290', '310'])
  })
})

describe('areaCheck', () => {
  const row = (width: string, depth: string, area: string) => ({ width, depth, area })

  it('считает обе стороны, при которых площадь сойдётся', () => {
    // 393 на 425 это 16,7 м², а на плане 16,3: верная ширина 383,5, верная глубина 414,8
    const check = areaCheck(row('393', '425', '16,3'))
    expect(check?.widthCm).toBe(384)
    expect(check?.depthCm).toBe(415)
  })

  it('на сходящихся числах молчит', () => {
    expect(areaCheck(row('383', '425', '16,3'))).toBeNull()
  })

  it('без одного из трёх чисел сверять не с чем', () => {
    expect(areaCheck(row('383', '', '16,3'))).toBeNull()
    expect(areaCheck(row('383', '425', ''))).toBeNull()
  })

  it('мусор в поле не превращается в предложение', () => {
    expect(areaCheck(row('не число', '425', '16,3'))).toBeNull()
  })
})

describe('комнаты с номерами', () => {
  const bedroom = (id: string, name: string) => ({
    id,
    name,
    kind: 'bedroom' as const,
    notes: null,
  })

  it('не выбирает первую комнату проекта при нескольких точных совпадениях', () => {
    const rows = planRows(reading([{ name: 'Спальня', kind: 'bedroom', sourceNumber: 6 }]), [
      { ...bedroom('r1', 'Спальня'), notes: 'Заметки первой' },
      { ...bedroom('r2', ' спальня '), notes: 'Заметки второй' },
    ])
    expect(rows[0]?.roomId).toBeUndefined()
    expect(rows[0]?.ambiguous).toBe(true)
    expect(rows[0]?.wish).toBe('')
  })

  it('не распределяет две исходные спальни по порядку после удаления номера', () => {
    const rows = planRows(
      reading([
        { name: 'Спальня 1', kind: 'bedroom', sourceNumber: 3 },
        { name: 'Спальня 2', kind: 'bedroom', sourceNumber: 6 },
      ]),
      [bedroom('r1', 'Спальня')],
    )
    expect(rows.every((row) => row.roomId === undefined && row.ambiguous === true)).toBe(true)
  })

  it('неточное совпадение не забирает комнату у следующей точной строки', () => {
    const rows = planRows(
      reading([
        { name: 'Спальня', kind: 'bedroom', sourceNumber: 3 },
        { name: 'Спальня 2', kind: 'bedroom', sourceNumber: 6 },
      ]),
      [bedroom('r2', 'Спальня 2')],
    )
    expect(rows[0]?.roomId).toBeUndefined()
    expect(rows[0]?.ambiguous).toBe(true)
    expect(rows[1]?.roomId).toBe('r2')
    expect(rows[1]?.ambiguous).toBeUndefined()
  })

  it('«Спальня 2» с плана достаётся «Спальне 2», а не первой попавшейся', () => {
    const rows = planRows(
      reading([
        { name: 'Спальня 2', kind: 'bedroom', widthCm: 350, depthCm: 460 },
        { name: 'Спальня 1', kind: 'bedroom', widthCm: 290, depthCm: 380 },
      ]),
      [bedroom('r1', 'Спальня 1'), bedroom('r2', 'Спальня 2')],
    )
    expect(rows[0]?.roomId).toBe('r2')
    expect(rows[1]?.roomId).toBe('r1')
  })

  it('одна «Спальня» с плана и две в проекте: не угадываем, а говорим об этом', () => {
    const rows = planRows(reading([{ name: 'Спальня', kind: 'bedroom', widthCm: 290 }]), [
      bedroom('r1', 'Спальня 1'),
      bedroom('r2', 'Спальня 2'),
    ])
    expect(rows[0]?.roomId).toBeUndefined()
    expect(rows[0]?.ambiguous).toBe(true)
  })

  it('одна «Спальня 1» в проекте — совпадение однозначно', () => {
    const rows = planRows(reading([{ name: 'Спальня', kind: 'bedroom', widthCm: 290 }]), [
      bedroom('r1', 'Спальня 1'),
    ])
    expect(rows[0]?.roomId).toBe('r1')
    expect(rows[0]?.ambiguous).toBeUndefined()
  })
})
