import { motion } from 'framer-motion'
import { staggerContainer } from '@/lib/animations'
import type { FeatureCard } from '@/types'
import Card from '@/components/ui/Card'

type FeaturesGridProps = {
  eyebrow?: string
  title: string
  copy: string
  items: FeatureCard[]
}

export default function FeaturesGrid({ eyebrow, title, copy, items }: FeaturesGridProps) {
  return (
    <section className="space-y-8 py-20">
      <div className="space-y-4">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2 className="section-title">{title}</h2>
        <p className="section-copy">{copy}</p>
      </div>

      <motion.div
        animate="visible"
        className="grid gap-5 lg:grid-cols-3"
        initial="hidden"
        variants={staggerContainer}
      >
        {items.map((item) => (
          <Card key={item.title} className="h-full">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
              {item.eyebrow}
            </div>
            <h3 className="mt-5 text-2xl font-semibold tracking-tight text-white">
              {item.title}
            </h3>
            <p className="mt-4 text-sm leading-7 text-muted">{item.description}</p>
            {item.detail ? <p className="mt-4 text-sm text-ink">{item.detail}</p> : null}
          </Card>
        ))}
      </motion.div>
    </section>
  )
}