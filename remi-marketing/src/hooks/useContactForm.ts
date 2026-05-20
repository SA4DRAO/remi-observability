import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import type { ContactFormValues } from '@/types'

const contactSchema = z.object({
  firstName: z.string().trim().min(2, 'Enter a first name.'),
  lastName: z.string().trim().min(2, 'Enter a last name.'),
  workEmail: z.email('Enter a valid work email.'),
  company: z.string().trim().min(2, 'Enter a company name.'),
  role: z.string().trim().min(2, 'Enter your role.'),
  project: z.string().trim().min(12, 'Share a bit more about your LangChain project.'),
})

const initialValues: ContactFormValues = {
  firstName: '',
  lastName: '',
  workEmail: '',
  company: '',
  role: '',
  project: '',
}

type FieldErrors = Partial<Record<keyof ContactFormValues, string>>

export function useContactForm() {
  const [values, setValues] = useState<ContactFormValues>(initialValues)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleChange = (field: keyof ContactFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))

    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitted(false)

    const result = contactSchema.safeParse(values)

    if (!result.success) {
      const nextErrors: FieldErrors = {}

      for (const issue of result.error.issues) {
        const field = issue.path[0]

        if (typeof field === 'string' && !(field in nextErrors)) {
          nextErrors[field as keyof ContactFormValues] = issue.message
        }
      }

      setErrors(nextErrors)
      return
    }

    setErrors({})
    setIsSubmitting(true)
    await new Promise((resolve) => window.setTimeout(resolve, 900))
    setIsSubmitting(false)
    setIsSubmitted(true)
    setValues(initialValues)
  }

  return {
    values,
    errors,
    isSubmitting,
    isSubmitted,
    handleChange,
    handleSubmit,
  }
}