/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#b3ccff',
          300: '#80abff',
          400: '#4d7fff',
          500: '#2a5cf0',
          600: '#1c42c4',
          700: '#16349a',
          800: '#122a78',
          900: '#0f2260',
          950: '#0a1740',
        },
        gold: {
          400: '#f2c94c',
          500: '#e0b027',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
