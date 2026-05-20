import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Button from '@/components/ui/Button'
import type { NavItem } from '@/types'

const navItems: NavItem[] = [
  { label: 'Features', to: '/features' },
  { label: 'Solutions', to: '/solutions' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Contact', to: '/contact' },
]

export default function Header() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-canvas/80 backdrop-blur-xl">
      <div className="container-shell flex h-20 items-center justify-between gap-6">
        <Link className="flex items-center gap-3" to="/">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 font-mono text-sm font-semibold text-accent-soft shadow-glow">
            R
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">Remi</div>
            <div className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-muted">
              Agent observability
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-white/8 bg-white/5 px-3 py-2 md:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) =>
                clsx(
                  'rounded-full px-4 py-2 text-sm font-medium transition',
                  isActive ? 'bg-white/10 text-white' : 'text-muted hover:text-white',
                )
              }
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <div className="rounded-full border border-accent/15 bg-accent/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-accent-soft">
            v1.2.0-beta now live
          </div>
          <Button to="/contact">Book a Demo</Button>
        </div>

        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white md:hidden"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span className="font-mono text-xs uppercase tracking-[0.24em]">
            {open ? 'Close' : 'Menu'}
          </span>
        </button>
      </div>

      {open ? (
        <div className="border-t border-white/8 bg-panel/95 px-4 py-4 md:hidden">
          <div className="container-shell flex flex-col gap-2 px-0">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                className={({ isActive }) =>
                  clsx(
                    'rounded-xl px-4 py-3 text-sm font-medium transition',
                    isActive ? 'bg-white/10 text-white' : 'text-muted hover:bg-white/5 hover:text-white',
                  )
                }
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
            <Button className="mt-2 justify-center" to="/contact">
              Book a Demo
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  )
}