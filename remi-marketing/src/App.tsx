import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Footer from '@/components/layout/Footer'
import Header from '@/components/layout/Header'
import Contact from '@/pages/Contact'
import Features from '@/pages/Features'
import Home from '@/pages/Home'
import Pricing from '@/pages/Pricing'
import Solutions from '@/pages/Solutions'

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [pathname])

  return null
}

function App() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-ink">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(99,102,241,0.16),transparent_24%),linear-gradient(180deg,#0e1416_0%,#090f11_100%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-40 [background-image:linear-gradient(rgba(133,147,151,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(133,147,151,0.08)_1px,transparent_1px)] [background-size:96px_96px]" />
      <ScrollToTop />
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/solutions" element={<Solutions />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
    </div>
  )
}

export default App
