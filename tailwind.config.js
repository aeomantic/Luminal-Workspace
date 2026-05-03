/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ── Kinetic Void colour tokens ──────────────────────────────────────
      // Containers are separated by background-colour shift only (no borders).
      colors: {
        surface: {
          DEFAULT:             '#131313', // base application background
          'container-lowest':  '#0e0e0e', // editor "sunken" canvas
          'container-low':     '#1c1b1b', // sidebar / file explorer
          container:           '#252525', // mid-level cards
          'container-high':    '#2e2d2d', // elevated cards
          'container-highest': '#353534', // floating overlays / modals
          bright:              '#3a3a3a', // active-input background shift
        },
        primary:   { DEFAULT: '#00b4d8', container: '#003d4d' }, // Electric Blue
        secondary: { DEFAULT: '#9d8df1', container: '#2a2245' }, // Soft Purple
        tertiary:  { DEFAULT: '#39d98a', container: '#0d3d22' }, // Mint Green
        'on-surface':         '#e8e8e8',
        'on-primary':         '#001f2a',
        'outline-variant':    'rgba(255,255,255,0.15)', // ghost-border fallback
      },

      // ── Typography ──────────────────────────────────────────────────────
      fontFamily: {
        display: ['"Inconsolata"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
        ui:      ['"Inconsolata"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
        mono:    ['"Inconsolata"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
      },

      // ── Roundedness tokens ──────────────────────────────────────────────
      borderRadius: {
        sm:      '0.25rem', // inputs / tight controls
        DEFAULT: '0.5rem',  // buttons / small cards
        lg:      '1rem',    // main containers
        xl:      '1.5rem',  // floating modals / overlays
        full:    '9999px',  // pills / chips
      },

      // ── Atmospheric shadows (diffused, no hard edges) ────────────────────
      boxShadow: {
        void:    '0 8px 60px 0 rgba(232,232,232,0.04)',
        palette: '0 4px 30px 0 rgba(0,0,0,0.65), 0 0 80px 0 rgba(0,180,216,0.07)',
      },

      // ── Backdrop-blur helpers ─────────────────────────────────────────────
      backdropBlur: {
        palette: '40px', // signature blur for the command palette
        glass:   '20px', // standard glassmorphic panels
      },
    },
  },
  plugins: [],
}
