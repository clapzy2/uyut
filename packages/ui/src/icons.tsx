import type { SVGProps } from 'react'

// Собственный набор: штрих 1.5, скруглённые концы, без заливок. Не больше двадцати на весь MVP.
const paths = {
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.8 5.8l1.5 1.5M16.7 16.7l1.5 1.5M5.8 18.2l1.5-1.5M16.7 7.3l1.5-1.5" />
    </>
  ),
  moon: <path d="M19.4 14.2a7.6 7.6 0 0 1-9.7-9.6 7.8 7.8 0 1 0 9.7 9.6Z" />,
  monitor: (
    <>
      <rect x="3.4" y="4.6" width="17.2" height="11.6" rx="1.6" />
      <path d="M9 19.5h6M12 16.3v3.1" />
    </>
  ),
  close: <path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8" />,
  check: <path d="M4.8 12.6l4.4 4.3L19.3 6.8" />,
  eye: (
    <>
      <path d="M2.8 12.1c2.3-4.2 5.4-6.3 9.2-6.3s6.9 2.1 9.2 6.3c-2.3 4.1-5.4 6.2-9.2 6.2s-6.9-2.1-9.2-6.2Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4.2 4.4l15.6 15.4M9.6 9.7A3 3 0 0 0 14.3 14.3M7 7.2C5.3 8.3 3.9 9.9 2.8 12.1c2.3 4.1 5.4 6.2 9.2 6.2 1.6 0 3.1-.4 4.4-1.1M11 5.9c.3 0 .7-.1 1-.1 3.8 0 6.9 2.1 9.2 6.3-.6 1.1-1.3 2.1-2 2.9" />
    </>
  ),
  upload: <path d="M12 16.2V5.2M7.4 9.6 12 5.1l4.6 4.5M4.6 18.6h14.8" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5.2M12 7.8v.2" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4.2 3.6 19h16.8L12 4.2Z" />
      <path d="M12 9.6v4.2M12 16.4v.2" />
    </>
  ),
} as const

export type IconName = keyof typeof paths

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
