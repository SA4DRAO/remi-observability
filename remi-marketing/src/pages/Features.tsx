import PageLayout from '@/components/layout/PageLayout'
import FeaturesGrid from '@/components/sections/FeaturesGrid'
import AnimatedSection from '@/components/ui/AnimatedSection'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

const featureHighlights = [
  {
    eyebrow: 'Timeline',
    title: 'Session detail view',
    description:
      'Inspect every LLM call, tool execution, and retrieval operation in a structured trace instead of sifting through noisy logs.',
    detail: 'Trace IDs, operation names, and latency stay aligned in one dense surface.',
  },
  {
    eyebrow: 'Economics',
    title: 'Real-time spend visibility',
    description:
      'Track token spend and model costs in real time so engineering teams can optimize prompt design and routing logic.',
    detail: 'Pair cost telemetry with latency and reliability to avoid optimizing in isolation.',
  },
  {
    eyebrow: 'Integration',
    title: 'Seamless LangChain instrumentation',
    description:
      'Drop in a Remi callback handler and start tracing with minimal surface area and no agent rewrite.',
    detail: 'Use the same handler for local experiments and production pipelines.',
  },
  {
    eyebrow: 'Analysis',
    title: 'Failure isolation',
    description:
      'Navigate straight to context window overflow, failing APIs, and tool retries without reconstructing the incident by hand.',
    detail: 'Shorten MTTR by surfacing the exact prompt and payload that caused the issue.',
  },
]

const economics = [
  ['Total spend (24h)', '$142.50', '12% down from yesterday'],
  ['Avg / interaction', '$0.003', 'Model mix optimized for routing'],
  ['Prompt tokens', '1.2M', 'Completion volume: 340K'],
  ['P99 latency', '850ms', 'Error rate 0.04%'],
]

export default function Features() {
  return (
    <PageLayout
      description="Inspect session timelines, trace token economics, instrument LangChain with minimal effort, and isolate production failures with Remi."
      title="Features"
    >
      <section className="space-y-6 py-10">
        <div className="eyebrow">Features deep dive</div>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-6xl">
          Observe. Optimize. Resolve.
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-muted sm:text-xl">
          Gain x-ray vision into your LLM applications. From atomic tool calls to macro cost trends, Remi provides engineering-grade telemetry designed for complex agentic systems.
        </p>
      </section>

      <FeaturesGrid
        copy="The features page in Stitch centers on session timelines, economics, integration, and error analysis. This implementation preserves that flow while translating it into reusable React sections."
        items={featureHighlights}
        title="Everything you need to debug, optimize, and trust production agents."
      />

      <section className="grid gap-6 py-20 lg:grid-cols-[1.15fr_0.85fr]">
        <AnimatedSection>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-white/8 px-6 py-5 sm:px-8">
              <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
                Session detail view
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
                Trace ID: 7a9b-f21c. Visualize the exact execution path of complex interactions with operation-level latency precision.
              </p>
            </div>
            <div className="space-y-4 px-6 py-6 sm:px-8">
              {[
                ['14:02:10.120', 'USER_MSG', '"What is the current status of order #9921?"', '-'],
                ['14:02:10.125', 'LLM_CALL', 'gpt-4-turbo-preview', '845ms'],
                ['14:02:10.970', 'TOOL_EXEC', 'get_order_status_db', '120ms'],
                ['14:02:11.812', 'TOOL_EXEC', 'fetch_shipping_eta', '78ms'],
              ].map(([time, type, detail, latency]) => (
                <div
                  key={time}
                  className="grid gap-3 rounded-2xl border border-white/8 bg-black/10 px-4 py-4 sm:grid-cols-[auto_auto_1fr_auto] sm:items-start"
                >
                  <div className="font-mono text-xs text-ink">{time}</div>
                  <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted">{type}</div>
                  <div className="text-sm text-ink">{detail}</div>
                  <div className="font-mono text-xs text-accent-soft">{latency}</div>
                </div>
              ))}
            </div>
          </Card>
        </AnimatedSection>

        <AnimatedSection className="space-y-5" delay={0.12}>
          {economics.map(([label, value, note]) => (
            <Card key={label} accent="amber">
              <div className="font-mono text-xs uppercase tracking-[0.24em] text-muted">{label}</div>
              <div className="mt-4 text-4xl font-semibold tracking-tight text-white">{value}</div>
              <p className="mt-3 text-sm leading-7 text-muted">{note}</p>
            </Card>
          ))}
        </AnimatedSection>
      </section>

      <section className="grid gap-6 py-20 lg:grid-cols-2 lg:items-start">
        <AnimatedSection>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-white/8 px-6 py-5 sm:px-8">
              <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
                Seamless integration
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">
                Attach the Remi handler to your LLM in minutes.
              </h2>
            </div>
            <pre className="overflow-x-auto px-6 py-6 font-mono text-sm leading-7 text-ink sm:px-8">{`from langchain.chat_models import ChatOpenAI
from remi.callbacks import RemiCallbackHandler

remi_handler = RemiCallbackHandler(
    project_key="prj_prod_x9y2"
)

llm = ChatOpenAI(
    temperature=0.7,
    callbacks=[remi_handler]
)`}</pre>
          </Card>
        </AnimatedSection>

        <AnimatedSection delay={0.12}>
          <Card accent="indigo">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
              Error analysis
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              Instant root-cause visibility when traces fail.
            </h2>
            <div className="mt-6 rounded-2xl border border-danger/20 bg-danger/10 p-5 font-mono text-sm text-danger">
              openai.error.InvalidRequestError: This model&apos;s maximum context length is 8192
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-black/10 p-5">
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted">Failure rate</div>
                <div className="mt-3 text-3xl font-semibold text-white">1.2%</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/10 p-5">
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted">MTTR</div>
                <div className="mt-3 text-3xl font-semibold text-white">4m 12s</div>
              </div>
            </div>
            <div className="mt-8">
              <Button to="/contact">See this on your traces</Button>
            </div>
          </Card>
        </AnimatedSection>
      </section>
    </PageLayout>
  )
}