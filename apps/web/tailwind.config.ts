import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1280px' } },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      colors: {
        background: hsl('background'),
        foreground: hsl('foreground'),
        card: { DEFAULT: hsl('card'), foreground: hsl('card-foreground') },
        popover: { DEFAULT: hsl('popover'), foreground: hsl('popover-foreground') },
        primary: { DEFAULT: hsl('primary'), foreground: hsl('primary-foreground') },
        secondary: { DEFAULT: hsl('secondary'), foreground: hsl('secondary-foreground') },
        muted: { DEFAULT: hsl('muted'), foreground: hsl('muted-foreground') },
        accent: { DEFAULT: hsl('accent'), foreground: hsl('accent-foreground') },
        destructive: { DEFAULT: hsl('destructive'), foreground: hsl('destructive-foreground') },
        // Marketplace-specific roles
        saffron: { DEFAULT: hsl('saffron'), foreground: hsl('saffron-foreground') },
        verified: hsl('verified'),
        border: hsl('border'),
        input: hsl('input'),
        ring: hsl('ring'),
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        // Low, warm shadows — cards sit on paper rather than float.
        card: '0 1px 0 hsl(var(--foreground) / 0.04), 0 1px 3px hsl(var(--foreground) / 0.06)',
        lift: '0 8px 24px -12px hsl(var(--foreground) / 0.25)',
      },
      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // Landing wordmark: each letter falls in, lands with a squash and settles.
        'letter-drop': {
          '0%': {
            opacity: '0',
            transform: 'translateY(-0.75em) rotate(var(--tilt, 0deg))',
            animationTimingFunction: 'cubic-bezier(0.5, 0, 0.9, 0.5)',
          },
          '15%': { opacity: '1' },
          '48%': {
            transform: 'translateY(0) scale(1.12, 0.84)',
            animationTimingFunction: 'cubic-bezier(0.2, 0.7, 0.4, 1)',
          },
          '68%': {
            transform: 'translateY(-0.09em) scale(0.96, 1.05)',
            animationTimingFunction: 'cubic-bezier(0.5, 0, 0.8, 0.5)',
          },
          '84%': { transform: 'translateY(0) scale(1.03, 0.97)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'letter-rise': {
          from: { transform: 'translateY(110%)' },
          to: { transform: 'none' },
        },
        'wipe-in': {
          from: { clipPath: 'inset(0 100% 0 0 round 0.12em)' },
          to: { clipPath: 'inset(0 0 0 0 round 0.12em)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(5deg)' },
          '50%': { transform: 'translateY(-0.05em) rotate(1deg)' },
        },
        ripple: {
          from: { transform: 'translate(-50%, -50%) scale(0)', opacity: '0.8' },
          to: { transform: 'translate(-50%, -50%) scale(1)', opacity: '0' },
        },
        // Landing Sign up pill: the countdown before it hands off to /signup.
        'fill-x': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'rise-in': 'rise-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'letter-drop': 'letter-drop 900ms both',
        'letter-rise': 'letter-rise 650ms cubic-bezier(0.3, 1.35, 0.5, 1) both',
        'wipe-in': 'wipe-in 600ms cubic-bezier(0.65, 0, 0.35, 1) both',
        float: 'float 6s ease-in-out infinite',
        ripple: 'ripple 750ms cubic-bezier(0.2, 0.6, 0.3, 1) forwards',
        'fill-x': 'fill-x 4s linear both',
      },
    },
  },
  plugins: [animate],
};

export default config;
