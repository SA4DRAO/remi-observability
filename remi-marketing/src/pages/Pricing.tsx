import type { PricingPlan } from '@/types'
import PageLayout from '@/components/layout/PageLayout'
import PricingCards from '@/components/sections/PricingCards'
import AnimatedSection from '@/components/ui/AnimatedSection'
import Card from '@/components/ui/Card'

const plans: PricingPlan[] = [
  {
    name: 'Starter',
    price: '$0',
    cadence: '/mo',
    description: 'Perfect for individuals and hobbyists exploring agentic workflows.',
    features: ['Up to 10k monthly events', 'Basic dashboards', '7-day data retention'],
    cta: 'Get Started Free',
  },
  {
    name: 'Pro',
    price: '$99',
    cadence: '/mo',
    description: 'For production teams requiring deep visibility, advanced metrics, and alerting.',
    features: ['1M monthly events', 'Advanced metrics & traces', 'Custom alerts', '30-day data retention'],
    cta: 'Start 14-Day Trial',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: '',
    description: 'Mission-critical reliability for large-scale deployments and internal platform teams.',
    features: ['Unlimited events', 'SSO / SAML integration', 'Dedicated support engineer', 'Long-term data retention'],
    cta: 'Contact Sales',
  },
]

const compareRows = [
  ['Monthly events', '10,000', '1,000,000', 'Unlimited'],
  ['Data retention', '7 days', '30 days', 'Custom'],
  ['Dashboards', 'Basic', 'Advanced', 'Custom'],
  ['Alerting', 'No', 'Yes', 'Yes'],
  ['SSO / SAML', 'No', 'No', 'Yes'],
]

const faq = [
  ['What counts as an event?', 'Every traced agent action, model call, tool execution, or workflow step captured by the Remi handler counts as an event.'],
  ['Can I upgrade or downgrade at any time?', 'Yes. Plans are designed to scale with your usage and can be adjusted as workloads change.'],
  ['Do you offer discounts for open-source projects?', 'Yes. Contact the team with your repository details and planned usage so we can work through the right package.'],
]

export default function Pricing() {
  return (
    <PageLayout
      description="Transparent pricing for teams instrumenting and operating LangChain and agentic workflows with Remi."
      title="Pricing"
    >
      <section className="space-y-6 py-10">
        <div className="eyebrow">Transparent pricing for agentic teams</div>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-6xl">
          Start small, then scale seamlessly as your workflows grow.
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-muted sm:text-xl">
          The Stitch pricing page balances low-friction entry with a clear production path. This implementation preserves that positioning and the three-tier structure.
        </p>
      </section>

      <section className="py-20">
        <PricingCards plans={plans} />
      </section>

      <section className="py-20">
        <AnimatedSection>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-white/8 px-6 py-5 sm:px-8">
              <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
                Compare plans
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
                Core metrics, platform features, and enterprise controls side by side.
              </p>
            </div>
            <div className="overflow-x-auto px-6 py-6 sm:px-8">
              <table className="w-full min-w-[42rem] text-left text-sm text-muted">
                <thead>
                  <tr className="border-b border-white/8 font-mono text-xs uppercase tracking-[0.22em] text-accent-soft">
                    <th className="pb-4">Capability</th>
                    <th className="pb-4">Starter</th>
                    <th className="pb-4">Pro</th>
                    <th className="pb-4">Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map(([label, starter, pro, enterprise]) => (
                    <tr key={label} className="border-t border-white/8">
                      <td className="py-4 text-ink">{label}</td>
                      <td className="py-4">{starter}</td>
                      <td className="py-4 text-white">{pro}</td>
                      <td className="py-4">{enterprise}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </AnimatedSection>
      </section>

      <section className="space-y-5 py-20">
        <div className="eyebrow">Frequently asked questions</div>
        <h2 className="section-title">Questions teams ask before they ship with Remi.</h2>
        <div className="grid gap-5 lg:grid-cols-3">
          {faq.map(([question, answer]) => (
            <Card key={question} accent="amber">
              <h3 className="text-xl font-semibold tracking-tight text-white">{question}</h3>
              <p className="mt-4 text-sm leading-7 text-muted">{answer}</p>
            </Card>
          ))}
        </div>
      </section>
    </PageLayout>
  )
}