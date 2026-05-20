import { Link } from 'react-router-dom'
import PageLayout from '@/components/layout/PageLayout'
import ContactForm from '@/components/sections/ContactForm'
import AnimatedSection from '@/components/ui/AnimatedSection'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

const teams = ['Acme Corp', 'Global ML', 'DataSynd', 'Nexus AI']

export default function Contact() {
  return (
    <PageLayout
      description="Request a Remi demo and talk through the traces, metrics, and failure workflows that matter to your engineering team."
      title="Contact"
    >
      <section className="space-y-6 py-10">
        <Link className="inline-flex items-center gap-2 text-sm text-muted transition hover:text-white" to="/">
          <span className="font-mono text-xs uppercase tracking-[0.22em]">Back to site</span>
        </Link>
        <div className="eyebrow">Request a demo</div>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-6xl">
          See how Remi can accelerate your agentic workflows.
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-muted sm:text-xl">
          We will walk through the traces, timelines, and economics views that matter to your LangChain application.
        </p>
      </section>

      <section className="grid gap-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <AnimatedSection>
          <ContactForm />
        </AnimatedSection>

        <AnimatedSection className="space-y-5" delay={0.12}>
          <Card accent="indigo">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
              Join forward-thinking AI teams
            </div>
            <p className="mt-4 text-sm leading-7 text-muted">
              Leading engineering organizations trust Remi to trace, debug, and monitor complex LLM applications in production.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {teams.map((team) => (
                <div
                  key={team}
                  className="rounded-2xl border border-white/8 bg-black/10 px-4 py-4 text-center font-mono text-sm uppercase tracking-[0.18em] text-ink"
                >
                  {team}
                </div>
              ))}
            </div>
          </Card>

          <Card accent="cyan">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
              Built by engineers, for engineers
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              High-density signal, low-latency decisions.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted">
              Remi is designed around the friction teams feel when agents hit production: hidden tool latency, uncertain spend, and brittle error workflows. Every surface is built to make traces actionable.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="#" variant="secondary">
                Explore technical docs
              </Button>
              <Button to="/pricing" variant="ghost">
                Review pricing
              </Button>
            </div>
          </Card>
        </AnimatedSection>
      </section>
    </PageLayout>
  )
}