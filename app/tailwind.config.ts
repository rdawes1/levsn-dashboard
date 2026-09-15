import type { Config } from 'tailwindcss';

/**
 * Palette sampled directly from clevelandwateralliance.org so the dashboard
 * sits seamlessly inside the LEVSN page.
 *   deep  #003594  rgb(0,53,148)    headings, shell background
 *   cyan  #00B4E5  rgb(0,180,229)   accent, interactive, section headings
 *   navy  #081434  rgb(8,20,52)     deepest background
 *   ink   #333333  body copy
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cwa: {
          deep: '#003594',
          deeper: '#002A76',
          navy: '#081434',
          cyan: '#00B4E5',
          cyanDark: '#0092BC',
          slate: '#3A4B64',
          mist: '#E9EAEB',
          silver: '#D0D3D4',
          ink: '#333333',
        },
        status: {
          ok: '#2E7D57',
          okSoft: '#E6F2EC',
          warn: '#B26A00',
          warnSoft: '#FDF1E0',
          alert: '#B3261E',
          alertSoft: '#FBEAE9',
        },
      },
      fontFamily: {
        sans: ['Rubik', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Bitter', 'Georgia', 'serif'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(8,20,52,.06), 0 8px 24px -12px rgba(8,20,52,.28)',
        rail: '0 1px 3px rgba(8,20,52,.10)',
      },
      borderRadius: { panel: '10px' },
    },
  },
  plugins: [],
} satisfies Config;
