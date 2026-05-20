import type { ReactNode } from 'react'

type GradientTextProps = {
  children: ReactNode
  className?: string
}

export default function GradientText({ children, className }: GradientTextProps) {
  return (
    <span
      className={[
        'bg-gradient-to-r from-accent-soft via-accent to-indigo bg-clip-text text-transparent',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  )
}