import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const variantClasses: Record<Variant, string> = {
  primary:
    'border border-accent/40 bg-accent text-slate-950 shadow-glow hover:-translate-y-0.5 hover:bg-accent-soft',
  secondary:
    'border border-white/12 bg-white/5 text-white hover:border-accent/40 hover:bg-accent/10',
  ghost: 'border border-transparent bg-transparent text-muted hover:bg-white/5 hover:text-white',
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-5 py-3 text-sm',
  lg: 'px-6 py-3.5 text-base',
}

export function buttonClasses(variant: Variant, size: Size, className?: string) {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium tracking-tight transition duration-300',
    variantClasses[variant],
    sizeClasses[size],
    className,
  )
}

type ButtonProps = {
  children: ReactNode
  className?: string
  variant?: Variant
  size?: Size
  to?: string
  href?: string
  external?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  to,
  href,
  external = false,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = buttonClasses(variant, size, className)

  if (to) {
    return (
      <Link className={classes} to={to}>
        {children}
      </Link>
    )
  }

  if (href) {
    return (
      <a
        className={classes}
        href={href}
        rel={external ? 'noreferrer' : undefined}
        target={external ? '_blank' : undefined}
      >
        {children}
      </a>
    )
  }

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  )
}