import PageLayout from '@/components/layout/PageLayout'
import AnimatedSection from '@/components/ui/AnimatedSection'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

const supportTimeline = [
  '00:01 User intent detected: refund request',
  '00:03 Tool call: fetch_order_status(id="ORD-992")',
  '00:05 Resolution achieved: success',
]

const platformLogs = [
  '14:02:11.001 INFO Model router selected gpt-4-turbo',
  '14:02:11.450 INFO Executing pre-processing pipeline',
  '14:02:12.892 CRITICAL Vector DB timeout during grounding',
  '14:02:12.905 WARN Fallback knowledge base triggered',
]

export default function Solutions() {
  return (
    <PageLayout
      description="See how Remi supports customer support operations, platform engineering, and cross-functional teams responsible for agent quality."
      title="Solutions"
    >
      <section className="space-y-6 py-10">
        <div className="eyebrow">Purpose-built workflows</div>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-6xl">
          Precision observability for the agentic era.
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-muted sm:text-xl">
          Whether you are optimizing customer support agent trajectories or debugging core platform infrastructure, Remi gives each team the telemetry it needs to act quickly and decisively.
        </p>
      </section>

      <section className="grid gap-6 py-20 lg:grid-cols-2">
        <AnimatedSection>
          <Card accent="cyan">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
              support_agent Customer Support Operations
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              Optimize resolution paths and guarantee session quality.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted">
              Visualize full conversational paths, surface loops in order modification flows, and correlate tool performance with escalation rates.
            </p>
            <div className="mt-8 space-y-3 rounded-2xl border border-white/8 bg-black/10 p-5 font-mono text-sm text-ink">
              {supportTimeline.map((item) => (
                <div key={item} className="rounded-xl border border-white/6 bg-white/5 px-4 py-3">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-black/10 p-5">
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted">Tool execution latency</div>
                <div className="mt-3 text-3xl font-semibold text-white">124 ms avg</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/10 p-5">
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted">Token efficiency</div>
                <div className="mt-3 text-3xl font-semibold text-white">1.2M / 340K</div>
              </div>
            </div>
            <blockquote className="mt-8 border-l border-accent/30 pl-4 text-sm leading-7 text-muted">
              “Remi reduced our escalation rate by 40% simply by exposing where our support agent was getting stuck in loops.”
            </blockquote>
          </Card>
        </AnimatedSection>

        <AnimatedSection delay={0.12}>
          <Card accent="indigo">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
              terminal Platform Engineering
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              Deep-dive failure analysis, structural logging, and SLA monitoring.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted">
              Move directly from an alert into the exact LLM prompt, tool payload, and retrieval context that caused the incident.
            </p>
            <div className="mt-8 space-y-3 rounded-2xl border border-white/8 bg-black/10 p-5 font-mono text-sm text-ink">
              {platformLogs.map((item) => (
                <div key={item} className="rounded-xl border border-white/6 bg-white/5 px-4 py-3">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                ['P99 latency', '850ms'],
                ['Error rate', '0.04%'],
                ['Rate-limit hits', '12 / hr'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/8 bg-black/10 p-5">
                  <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted">{label}</div>
                  <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
                </div>
              ))}
            </div>
            <blockquote className="mt-8 border-l border-indigo/30 pl-4 text-sm leading-7 text-muted">
              “The ability to jump directly from a PagerDuty alert into the exact failing prompt turned probabilistic debugging into a deterministic process.”
            </blockquote>
          </Card>
        </AnimatedSection>
      </section>

      <section className="py-20">
        <Card className="glass-card-strong p-8 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="eyebrow">Shared context across teams</div>
              <h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                One source of truth for support, platform, and ML engineering.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
                Keep trace context, latency breakdowns, and token spend aligned so every team can debug faster without trading screenshots across tools.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Button size="lg" to="/contact">
                Contact sales
              </Button>
              <Button size="lg" to="/pricing" variant="secondary">
                Review plans
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </PageLayout>
  )
}