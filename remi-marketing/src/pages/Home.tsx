import PageLayout from '@/components/layout/PageLayout'
import FeaturesGrid from '@/components/sections/FeaturesGrid'
import HeroSection from '@/components/sections/HeroSection'
import AnimatedSection from '@/components/ui/AnimatedSection'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

const observabilitySignals = [
  {
    eyebrow: 'Structured timelines',
    title: 'Turn raw agent behavior into something you can inspect.',
    description:
      'Stop digging through unformatted terminal logs. Visualize every thought, action, and observation in a structured, searchable timeline.',
    detail: 'From atomic tool calls to macro cost trends, every execution path becomes explainable.',
  },
  {
    eyebrow: 'Cost visibility',
    title: 'Know what happened, how long it took, and what it cost.',
    description:
      'Track token spend, model costs, and latency in the same surface you use to debug behavior.',
    detail: 'Surface regressions before they become budget problems or reliability incidents.',
  },
  {
    eyebrow: 'Drop-in SDK',
    title: 'Built for LangChain workflows.',
    description:
      'Integrate Remi via a custom callback handler. No need to rewrite your chains or agents to start tracing.',
    detail: 'Attach one handler and capture the full execution trace in under two minutes.',
  },
]

const timelineRows = [
  ['14:02:10.120', 'USER_MSG', 'What is the current status of order #9921?', '-'],
  ['14:02:10.125', 'LLM_CALL', 'gpt-4-turbo-preview', '845ms'],
  ['14:02:10.970', 'TOOL_EXEC', 'get_order_status_db', '120ms'],
  ['14:02:11.450', 'RAG_FETCH_CTX', 'contextual grounding', '1.44s'],
]

const proofPoints = [
  ['Session trajectories', 'See the exact path an agent took from user input to resolution state.'],
  ['Tool latency', 'Spot bottlenecks and failing integrations without rebuilding logs by hand.'],
  ['Prompt economics', 'Understand prompt, completion, and rerun cost with engineering precision.'],
  ['Error analysis', 'Navigate from alert to failing trace context in a single jump.'],
]

export default function Home() {
  return (
    <PageLayout
      description="Remi gives engineering teams precise observability for LangChain and agentic workflows, from trace timelines to token economics and failure analysis."
      title="Precision Observability for the Agentic Era"
    >
      <HeroSection />

      <FeaturesGrid
        copy="Whether you are optimizing customer support agent trajectories or debugging platform infrastructure, Remi provides the exact telemetry required to ensure deterministic outcomes from probabilistic models."
        eyebrow="Observe. optimize. resolve."
        items={observabilitySignals}
        title="Engineering-grade telemetry for complex agentic systems."
      />

      <section className="grid gap-6 py-20 lg:grid-cols-[1.15fr_0.85fr]">
        <AnimatedSection>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-white/8 px-6 py-5 sm:px-8">
              <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
                Session detail view
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">
                Visualize the exact execution path of complex interactions.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
                Drill down into individual LLM calls, tool executions, and retrieval operations with latency precision.
              </p>
            </div>
            <div className="overflow-x-auto px-6 py-6 sm:px-8">
              <table className="w-full min-w-[38rem] text-left text-sm text-muted">
                <thead>
                  <tr className="font-mono text-xs uppercase tracking-[0.22em] text-accent-soft">
                    <th className="pb-4">Time</th>
                    <th className="pb-4">Type</th>
                    <th className="pb-4">Operation / name</th>
                    <th className="pb-4 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {timelineRows.map(([time, type, detail, latency]) => (
                    <tr key={time} className="border-t border-white/8">
                      <td className="py-4 font-mono text-xs text-ink">{time}</td>
                      <td className="py-4 font-mono text-xs uppercase tracking-[0.2em] text-muted">
                        {type}
                      </td>
                      <td className="py-4 text-ink">{detail}</td>
                      <td className="py-4 text-right text-white">{latency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </AnimatedSection>

        <AnimatedSection className="space-y-5" delay={0.12}>
          {proofPoints.map(([title, description]) => (
            <Card key={title} accent="indigo">
              <h3 className="text-xl font-semibold tracking-tight text-white">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted">{description}</p>
            </Card>
          ))}
        </AnimatedSection>
      </section>

      <section className="grid gap-6 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <AnimatedSection className="space-y-5">
          <div className="eyebrow">LangChain integration</div>
          <h2 className="section-title">Start tracing without rewriting your agent logic.</h2>
          <p className="section-copy">
            Remi integrates through a dedicated callback handler. Initialize it once, attach it to your LLM or agent, and capture every runtime event automatically.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button to="/features">Features deep dive</Button>
            <Button to="/contact" variant="secondary">
              Talk to sales
            </Button>
          </div>
        </AnimatedSection>

        <AnimatedSection delay={0.16}>
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted">langchain_app.py</div>
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-accent-soft">
                copy snippet
              </div>
            </div>
            <pre className="overflow-x-auto px-6 py-6 font-mono text-sm leading-7 text-ink">
              <code>{`from remi.callbacks import RemiCallbackHandler
from langchain.agents import initialize_agent

remi_handler = RemiCallbackHandler(
    api_key="rm_...",
    project_id="prod-agents"
)

agent = initialize_agent(
    tools,
    llm,
    agent="zero-shot-react-description",
    callbacks=[remi_handler],
)`}</code>
            </pre>
          </Card>
        </AnimatedSection>
      </section>

      <section className="py-20">
        <Card className="glass-card-strong overflow-hidden p-8 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-4">
              <div className="eyebrow">Production-critical observability</div>
              <h2 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                When agents become part of the product, observability becomes product-critical.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted sm:text-lg">
                Give platform, ML, and support teams a shared source of truth for how each agent run behaved in production.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Button size="lg" to="/contact">
                Get started
              </Button>
              <Button size="lg" to="/pricing" variant="secondary">
                Explore pricing
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </PageLayout>
  )
}