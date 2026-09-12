import { cn } from '@uyut/ui'
import { formatShare } from '@/lib/shopping/format'

type Props = {
  shares: { furniture: number; works: number; free: number }
  /** Подпись третьего сегмента: «запас 505 750 ₽» или «перерасход 80 000 ₽» */
  freeLabel: string
  overBudget: boolean
  className?: string
}

// Горизонтальная линия из трёх сегментов: мебель, работы и то, что остаётся от бюджета
export function BudgetBar({ shares, freeLabel, overBudget, className }: Props) {
  const label = `Мебель ${formatShare(shares.furniture)}, работы ${formatShare(shares.works)}, ${freeLabel}`
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex h-2 gap-0.5" role="img" aria-label={label}>
        <span
          className="motion-budget-segment block h-full bg-accent"
          style={{ width: `${shares.furniture * 100}%` }}
        />
        <span
          className="motion-budget-segment block h-full bg-ink-2/70"
          style={{ width: `${shares.works * 100}%`, animationDelay: '90ms' }}
        />
        <span
          className={cn(
            'motion-budget-segment block h-full',
            overBudget ? 'bg-danger/60' : 'bg-line',
          )}
          style={{
            width: `${shares.free * 100}%`,
            minWidth: overBudget ? '2px' : undefined,
            animationDelay: '180ms',
          }}
        />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <li className="flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block h-2 w-2 bg-accent" />
          Мебель {formatShare(shares.furniture)}
        </li>
        <li className="flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block h-2 w-2 bg-ink-2/70" />
          Работы {formatShare(shares.works)}
        </li>
        <li className={cn('flex items-center gap-1.5', overBudget && 'text-danger')}>
          <i
            aria-hidden="true"
            className={cn('inline-block h-2 w-2', overBudget ? 'bg-danger/60' : 'bg-line')}
          />
          {freeLabel}
        </li>
      </ul>
    </div>
  )
}
