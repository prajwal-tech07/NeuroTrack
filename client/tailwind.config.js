/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F2EEFE',
          100: '#E5DDFD',
          200: '#CBBBFB',
          300: '#AC93F6',
          400: '#8A67ED',
          500: '#6D3FE3',
          600: '#5B2BD9',
          700: '#4A1FB4',
          800: '#3A188C',
          900: '#2B1268',
        },
        ink: {
          DEFAULT: '#1E1B33',
          soft: '#3A3654',
        },
        risk: {
          low: '#16A34A',
          mild: '#F59E0B',
          moderate: '#EA580C',
          high: '#DC2626',
        },
        surface: {
          light: '#F5F6FA',
          dark: '#12111C',
          card: '#FFFFFF',
          cardDark: '#1C1B29',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 6px 20px -8px rgba(16,24,40,.10)',
        lift: '0 8px 30px -12px rgba(91,43,217,.35)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(.9)', opacity: '.7' },
          '70%': { transform: 'scale(1.35)', opacity: '0' },
          '100%': { opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s ease-out both',
        'pulse-ring': 'pulseRing 1.8s cubic-bezier(.2,.6,.4,1) infinite',
      },
    },
  },
  plugins: [],
};
