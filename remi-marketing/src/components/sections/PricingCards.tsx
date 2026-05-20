import type { PricingPlan } from '@/types'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

type PricingCardsProps = {
  plans: PricingPlan[]
}

export default function PricingCards({ plans }: PricingCardsProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      {plans.map((plan) => (
        <Card
          key={plan.name}
          accent={plan.featured ? 'cyan' : 'indigo'}
          className={plan.featured ? 'border-accent/35 bg-accent/10 shadow-glow' : ''}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-mono text-xs uppercase tracking-[0.24em] text-muted">
                {plan.name}
              </div>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-4xl font-semibold tracking-tight text-white">
                  {plan.price}
                </span>
                <span className="pb-1 text-sm text-muted">{plan.cadence}</span>
              </div>
            </div>
            {plan.featured ? (
              <div className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-accent-soft">
                Most popular
              </div>
            ) : null}
          </div>
          <p className="mt-5 text-sm leading-7 text-muted">{plan.description}</p>
          <ul className="mt-8 space-y-3 text-sm text-ink">
            {plan.features.map((feature) => (
              <li key={feature} className="flex gap-3">
                <span className="mt-1 font-mono text-xs text-accent-soft">check</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <Button
            className="mt-8 w-full justify-center"
            to="/contact"
            variant={plan.featured ? 'primary' : 'secondary'}
          >
            {plan.cta}
          </Button>
        </Card>
      ))}
    </div>
  )
}