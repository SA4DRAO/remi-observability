import type { ContactFormValues } from '@/types'
import { useContactForm } from '@/hooks/useContactForm'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

const fields: Array<{
  key: keyof ContactFormValues
  label: string
  placeholder: string
}> = [
  { key: 'firstName', label: 'First name', placeholder: 'Ada' },
  { key: 'lastName', label: 'Last name', placeholder: 'Lovelace' },
  { key: 'workEmail', label: 'Work email', placeholder: 'ada@company.com' },
  { key: 'company', label: 'Company', placeholder: 'Acme AI' },
  { key: 'role', label: 'Role', placeholder: 'Staff ML Engineer' },
]

export default function ContactForm() {
  const {
    values,
    errors,
    isSubmitting,
    isSubmitted,
    handleChange,
    handleSubmit,
  } = useContactForm()

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/8 px-6 py-5 sm:px-8">
        <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent-soft">
          Request a demo
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
          Tell us about your LangChain project and we will walk through the exact
          traces, metrics, and failure workflows that matter to your team.
        </p>
      </div>
      <form className="space-y-6 px-6 py-6 sm:px-8 sm:py-8" onSubmit={handleSubmit}>
        <div className="grid gap-5 md:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className="space-y-2">
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted">
                {field.label}
              </span>
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-muted focus:border-accent focus:ring-accent"
                onChange={(event) => handleChange(field.key, event.target.value)}
                placeholder={field.placeholder}
                type={field.key === 'workEmail' ? 'email' : 'text'}
                value={values[field.key]}
              />
              {errors[field.key] ? (
                <span className="text-sm text-danger">{errors[field.key]}</span>
              ) : null}
            </label>
          ))}
        </div>

        <label className="block space-y-2">
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted">
            Tell us about your LangChain project
          </span>
          <textarea
            className="min-h-40 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-muted focus:border-accent focus:ring-accent"
            onChange={(event) => handleChange('project', event.target.value)}
            placeholder="Where do your agents get expensive, slow, or brittle today?"
            value={values.project}
          />
          {errors.project ? <span className="text-sm text-danger">{errors.project}</span> : null}
        </label>

        <div className="flex flex-col gap-4 border-t border-white/8 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm leading-7 text-muted">
            This demo form currently validates and captures intent in the UI.
            Connect it to your preferred lead pipeline when you are ready to go live.
          </p>
          <Button className="justify-center sm:min-w-48" size="lg" type="submit">
            {isSubmitting ? 'Sending…' : 'Request demo'}
          </Button>
        </div>

        {isSubmitted ? (
          <div className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
            Thanks. Your demo request is staged in the frontend and ready for backend integration.
          </div>
        ) : null}
      </form>
    </Card>
  )
}