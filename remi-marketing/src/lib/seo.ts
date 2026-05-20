export const siteName = 'Remi'

export const defaultDescription =
  'Remi gives engineering teams precise observability for LangChain and agentic workflows, from trace timelines to token economics and failure analysis.'

export function buildPageTitle(title: string): string {
  return title === siteName ? siteName : `${title} | ${siteName}`
}