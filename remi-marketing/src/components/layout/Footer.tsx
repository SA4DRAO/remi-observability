import { Link } from 'react-router-dom'

const productLinks = [
  { label: 'Features', to: '/features' },
  { label: 'Solutions', to: '/solutions' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Contact', to: '/contact' },
]

const resourceLinks = [
  { label: 'Docs', href: '#' },
  { label: 'Status', href: '#' },
  { label: 'Security', href: '#' },
  { label: 'Changelog', href: '#' },
]

const legalLinks = [
  { label: 'Privacy Policy', href: '#' },
  { label: 'Terms of Service', href: '#' },
]

export default function Footer() {
  return (
    <footer className="border-t border-white/8 bg-black/10 py-12">
      <div className="container-shell grid gap-10 lg:grid-cols-[1.2fr_repeat(3,minmax(0,1fr))]">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 font-mono text-sm font-semibold text-accent-soft shadow-glow">
              R
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight text-white">Remi</div>
              <div className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-muted">
                Built for the agentic era.
              </div>
            </div>
          </div>
          <p className="max-w-sm text-sm leading-7 text-muted">
            Remi captures LangChain runtime events and turns them into session
            timelines, token economics, tool breakdowns, and error visibility.
          </p>
        </div>

        <div>
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.24em] text-muted">Product</div>
          <div className="space-y-3 text-sm text-muted">
            {productLinks.map((link) => (
              <div key={link.to}>
                <Link className="transition hover:text-white" to={link.to}>
                  {link.label}
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.24em] text-muted">Resources</div>
          <div className="space-y-3 text-sm text-muted">
            {resourceLinks.map((link) => (
              <div key={link.label}>
                <a className="transition hover:text-white" href={link.href}>
                  {link.label}
                </a>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.24em] text-muted">Legal</div>
          <div className="space-y-3 text-sm text-muted">
            {legalLinks.map((link) => (
              <div key={link.label}>
                <a className="transition hover:text-white" href={link.href}>
                  {link.label}
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="container-shell mt-10 border-t border-white/8 pt-6 text-sm text-muted">
        © 2026 Remi Labs Inc. Precision observability for agentic teams.
      </div>
    </footer>
  )
}