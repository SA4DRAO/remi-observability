export interface NavItem {
  label: string
  to: string
}

export interface FeatureCard {
  eyebrow: string
  title: string
  description: string
  detail?: string
}

export interface PricingPlan {
  name: string
  price: string
  cadence: string
  description: string
  features: string[]
  cta: string
  featured?: boolean
}

export interface ContactFormValues {
  firstName: string
  lastName: string
  workEmail: string
  company: string
  role: string
  project: string
}