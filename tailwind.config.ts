import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          50: '#fff8e1',
          100: '#ffecb3',
          400: '#f8c549',
          500: '#d6a21e',
          700: '#8a650c',
        },
        ink: '#101828',
      },
    },
  },
  plugins: [],
};

export default config;
