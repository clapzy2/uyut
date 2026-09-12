const shared = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/**
 * Штриховые рисунки для пустых экранов. Свои, не из библиотеки: линия тонкая, как у рамок,
 * и цвет наследуется, поэтому картинка живёт в обеих темах без второй версии.
 */
export function EmptyArt({
  kind,
  className,
}: {
  kind: 'rooms' | 'shopping' | 'concepts'
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 116 88"
      role="img"
      aria-hidden="true"
      className={`motion-empty-art ${className ?? ''}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{kind}</title>
      {kind === 'rooms' ? (
        <g {...shared}>
          <path d="M8 80V12h56v20h44v48z" />
          <path d="M64 32v48" />
          <path d="M8 56h24" />
          <path d="M40 80V56" opacity="0.55" />
          <path d="M32 56a16 16 0 0 1 16 16" opacity="0.55" />
          <path d="M84 32v12" opacity="0.55" />
          <path d="M96 44h-24" opacity="0.55" />
          <path d="M20 20h20" opacity="0.4" />
        </g>
      ) : null}
      {kind === 'shopping' ? (
        <g {...shared}>
          <path d="M20 8h52l16 16v56H20z" />
          <path d="M72 8v16h16" />
          <path d="M32 40h30" opacity="0.55" />
          <path d="M32 52h38" opacity="0.55" />
          <path d="M32 64h20" opacity="0.4" />
          <circle cx="26" cy="40" r="1.6" />
          <circle cx="26" cy="52" r="1.6" />
          <circle cx="26" cy="64" r="1.6" opacity="0.5" />
        </g>
      ) : null}
      {kind === 'concepts' ? (
        <g {...shared}>
          <path d="M12 12h92v56H12z" />
          <path d="M12 68h92" />
          <path d="M28 68V36h20v32" opacity="0.55" />
          <path d="M28 46h20" opacity="0.4" />
          <path d="M38 36v32" opacity="0.4" />
          <path d="M64 68c0-12 6-18 14-18s14 6 14 18" opacity="0.55" />
          <path d="M78 50V38" opacity="0.4" />
          <path d="M40 80h36" opacity="0.4" />
        </g>
      ) : null}
    </svg>
  )
}
