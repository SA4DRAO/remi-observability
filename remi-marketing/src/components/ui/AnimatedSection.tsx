import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useScrollAnimation } from '@/hooks/useScrollAnimation'
import { fadeUp } from '@/lib/animations'

type AnimatedSectionProps = {
  children: ReactNode
  className?: string
  delay?: number
}

export default function AnimatedSection({
  children,
  className,
  delay = 0,
}: AnimatedSectionProps) {
  const { ref, inView } = useScrollAnimation<HTMLDivElement>()

  return (
    <motion.div
      ref={ref}
      animate={inView ? 'visible' : 'hidden'}
      className={className}
      custom={delay}
      initial="hidden"
      variants={fadeUp}
    >
      {children}
    </motion.div>
  )
}