import clsx from 'clsx'
import type { HTMLAttributes, ReactNode } from 'react'

type Accent = 'cyan' | 'indigo' | 'amber'

const accents: Record<Accent, string> = {
  cyan: 'border-accent/20',
  indigo: 'border-indigo/20',
  amber: 'border-amber/20',
}

type CardProps = {
  children: ReactNode
  className?: string
  accent?: Accent
} & HTMLAttributes<HTMLDivElement>

export default function Card({ children, className, accent = 'cyan', ...props }: CardProps) {
  return (
    <div
      className={clsx(
        'glass-card rounded-2xl p-6 sm:p-8',
        accents[accent],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}