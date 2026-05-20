import forms from '@tailwindcss/forms'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0e1416',
        panel: '#161d1e',
        surface: '#1a2122',
        'surface-high': '#242b2d',
        'surface-bright': '#343a3c',
        line: '#3c494c',
        ink: '#dde4e5',
        muted: '#9eb0b5',
        accent: '#22d3ee',
        'accent-soft': '#8aebff',
        indigo: '#6366f1',
        amber: '#ffb13b',
        success: '#34d399',
        danger: '#ffb4ab',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        panel: '0 24px 80px rgba(0, 0, 0, 0.28)',
        glow: '0 0 0 1px rgba(34, 211, 238, 0.16), 0 20px 60px rgba(34, 211, 238, 0.12)',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.65' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 3s ease-in-out infinite',
      },
    },
  },
  plugins: [forms],
}