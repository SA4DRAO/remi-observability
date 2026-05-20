import { useEffect, useRef, useState } from 'react'

export function useScrollAnimation<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0.18 },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return { ref, inView }
}