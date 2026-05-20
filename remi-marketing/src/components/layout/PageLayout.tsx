import type { ReactNode } from 'react'
import { Helmet } from 'react-helmet-async'
import { buildPageTitle, defaultDescription } from '@/lib/seo'

type PageLayoutProps = {
  title: string
  description?: string
  children: ReactNode
}

export default function PageLayout({ title, description, children }: PageLayoutProps) {
  const metaDescription = description ?? defaultDescription

  return (
    <>
      <Helmet>
        <title>{buildPageTitle(title)}</title>
        <meta content={metaDescription} name="description" />
      </Helmet>
      <main className="container-shell pb-24 pt-28 sm:pt-32">{children}</main>
    </>
  )
}