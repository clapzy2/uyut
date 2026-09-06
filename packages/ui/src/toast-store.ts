import { create } from 'zustand'

export type ToastTone = 'neutral' | 'success' | 'danger'

export type ToastItem = {
  id: number
  title: string
  description?: string
  tone: ToastTone
}

type ToastInput = Omit<ToastItem, 'id' | 'tone'> & { tone?: ToastTone }

type ToastState = {
  items: ToastItem[]
  push: (input: ToastInput) => number
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (input) => {
    const id = nextId++
    set((state) => ({ items: [...state.items, { id, tone: 'neutral', ...input }] }))
    return id
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}))

// Вызывается из любого места: форм, серверных ответов, обработчиков
export function toast(input: ToastInput): number {
  return useToastStore.getState().push(input)
}
