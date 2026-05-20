import AnimatedSection from '@/components/ui/AnimatedSection'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import GradientText from '@/components/ui/GradientText'

const heroMetrics = [
  { label: 'Token usage', value: '452.1k', trend: '+12% vs last week' },
  { label: 'Model cost', value: '$14.20', trend: 'Avg $0.003 / interaction' },
  { label: 'P95 latency', value: '4.2s', trend: '-0.5s improvement' },
]

export default function HeroSection() {
  return (
    <section className="grid gap-8 pb-20 pt-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12">
      <AnimatedSection className="space-y-8">
        <div className="eyebrow">v1.2.0-beta now live</div>
        <div className="space-y-6">
          <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-6xl xl:text-7xl">
            <GradientText>Agents are harder to understand</GradientText> than apps.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted sm:text-xl">
            Remi captures LangChain runtime events and turns them into session
            timelines, token and cost metrics, tool breakdowns, and failure
            visibility for production agentic systems.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" to="/contact">
            Book a demo
          </Button>
          <Button size="lg" to="/features" variant="secondary">
            See how Remi works
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {heroMetrics.map((metric) => (
            <Card key={metric.label} className="p-4 sm:p-5">
              <div className="font-mono text-xs uppercase tracking-[0.24em] text-muted">
                {metric.label}
              </div>
              <div className="mt-4 text-3xl font-semibold tracking-tight text-white">
                {metric.value}
              </div>
              <div className="mt-2 text-sm text-muted">{metric.trend}</div>
            </Card>
          ))}
        </div>
      </AnimatedSection>

      <AnimatedSection className="relative" delay={0.12}>
        <div className="absolute inset-x-8 top-0 h-32 rounded-full bg-accent/20 blur-3xl" />
        <Card className="relative overflow-hidden p-0">
          <div className="border-b border-white/8 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-mono text-xs uppercase tracking-[0.24em] text-muted">
                  Live session timeline
                </div>
                <div className="mt-1 text-lg font-semibold text-white">Session: xyz-789</div>
              </div>
              <div className="rounded-full border border-success/20 bg-success/10 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-success">
                healthy
              </div>
            </div>
          </div>
          <div className="space-y-4 p-6">
            {[
              ['00:00', 'User Input', '“Summarize the recent changes in repo X”'],
              ['00:02', 'Agent Action', 'Calling tool: github_api_search'],
              ['01:45', 'Observation', 'Received 45 commits from main branch.'],
              ['02:10', 'Error', 'Rate limit exceeded. Retrying with backoff.'],
            ].map(([time, type, detail]) => (
              <div
                key={`${time}-${type}`}
                className="grid gap-2 rounded-2xl border border-white/8 bg-black/10 px-4 py-4 sm:grid-cols-[auto_auto_1fr] sm:items-start"
              >
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent-soft">
                  {time}
                </div>
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted">
                  {type}
                </div>
                <div className="text-sm leading-7 text-ink">{detail}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-px border-t border-white/8 bg-white/8 sm:grid-cols-3">
            {[
              ['Failure rate', '1.2%'],
              ['MTTR', '4m 12s'],
              ['Tool latency', '124 ms avg'],
            ].map(([label, value]) => (
              <div key={label} className="bg-panel px-5 py-4">
                <div className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-muted">
                  {label}
                </div>
                <div className="mt-2 text-xl font-semibold text-white">{value}</div>
              </div>
            ))}
          </div>
        </Card>
      </AnimatedSection>
    </section>
  )
}