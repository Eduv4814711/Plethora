import type { Config } from "tailwindcss";

/**
 * Plethora — primary brand orange on `security-navy` (legacy token name).
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "Notion Sans",
          "-apple-system",
          "system-ui",
          "Segoe UI",
          "Helvetica",
          "sans-serif",
        ],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        /** Primary brand orange (legacy class prefix `security-navy`) */
        "security-navy": {
          DEFAULT: "#FF9800",
          50: "#fff8f0",
          100: "#ffecd9",
          200: "#ffd9b3",
          300: "#ffc285",
          400: "#ffa726",
          500: "#ff9800",
          600: "#f57c00",
          700: "#ef6c00",
          800: "#e65100",
          900: "#bf360c",
        },
        /** Semantic warning — Notion brand-orange */
        "security-amber": {
          DEFAULT: "#dd5b00",
          50: "#fff4ed",
          100: "#ffe6d5",
          200: "#ffc9a8",
          300: "#ffa270",
          400: "#ff7938",
          500: "#dd5b00",
          600: "#c44f00",
          700: "#a04200",
        },
        /** Success — semantic-green */
        "security-emerald": {
          DEFAULT: "#1aae39",
          50: "#e8f9eb",
          100: "#c9efd2",
          200: "#96dfa8",
          300: "#5ec974",
          400: "#2fb74d",
          500: "#1aae39",
          600: "#159630",
          700: "#127d29",
        },
        notion: {
          canvas: "#ffffff",
          surface: "#f6f5f4",
          "surface-soft": "#fafaf9",
          ink: "#000000",
          charcoal: "#000000",
          slate: "#000000",
          steel: "#787671",
          hairline: "#e5e3df",
          "hairline-strong": "#c8c4be",
          navy: "#0a1530",
          "link-blue": "#0075de",
        },
        "wireframe-bg": "#fafaf9",
        "wireframe-accent": "#f0eeec",
      },
      boxShadow: {
        "security-card": "rgba(15, 15, 15, 0.04) 0px 1px 2px 0px",
        "security-card-hover": "rgba(15, 15, 15, 0.08) 0px 4px 12px 0px",
        "security-elevated": "rgba(15, 15, 15, 0.16) 0px 16px 48px -8px",
        "mockup-deep": "rgba(15, 15, 15, 0.2) 0px 24px 48px -8px",
      },
      borderWidth: {
        "wireframe-thin": "1px",
        "wireframe-thick": "2px",
      },
      borderRadius: {
        /** Notion md — buttons / inputs (8px) */
        security: "0.5rem",
        /** Notion lg — cards (12px) */
        "security-lg": "0.75rem",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
