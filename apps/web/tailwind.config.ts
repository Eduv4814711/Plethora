/**
 * Plethora — the duty board
 *
 * Graphite chrome, paper work surface, orange as a *signal* rather than a
 * background. The rule that drives every value below: saturation is reserved
 * for state. If a shift is live, an approval is waiting, or a control is
 * focused, it is orange. Everything else is graphite so the orange still means
 * something at the end of a twelve-hour shift.
 *
 * `security-navy` keeps its name (it is the chrome scale, used in ~400 places)
 * but is now graphite. `security-amber` is the brand orange signal scale.
 * `security-emerald` is green again — it was aliased to orange, which made
 * every success state read as a warning.
 *
 * @type {import("tailwindcss").Config}
 */
const config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Archivo", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Archivo", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // Chrome. Header, rail, primary actions, structure, secondary text.
        "security-navy": {
          DEFAULT: "#171A1F",
          50: "#F5F6F8",
          100: "#E8EAEE",
          200: "#D3D7DE",
          300: "#AFB6C1",
          400: "#7C8593",
          500: "#5A626E",
          600: "#434A55",
          700: "#2E343D",
          800: "#1F242B",
          900: "#171A1F",
          950: "#0E1013",
        },
        // Signal. Live shifts, waiting approvals, the active module, focus.
        "security-amber": {
          DEFAULT: "#F97A08",
          50: "#FFF6EC",
          100: "#FFE8CE",
          200: "#FDCE99",
          300: "#FBB05F",
          400: "#FA9327",
          500: "#F97A08",
          600: "#DB6403",
          700: "#A8480A",
          800: "#7C360B",
          900: "#5A280A",
          950: "#3D1A06",
        },
        // Covered, approved, on duty.
        "security-emerald": {
          DEFAULT: "#0E8A5F",
          50: "#ECFBF4",
          100: "#CFF4E4",
          200: "#9FE6C9",
          300: "#5FCEA5",
          400: "#27B183",
          500: "#0E8A5F",
          600: "#0B6E4C",
          700: "#08553B",
          800: "#06412D",
          900: "#042E20",
          950: "#021D14",
        },
        "wireframe-bg": "#F5F6F8",
        "wireframe-accent": "#E8EAEE",
        ink: {
          DEFAULT: "#171A1F",
          100: "#E8EAEE",
          300: "#AFB6C1",
          500: "#5A626E",
          700: "#2E343D",
          900: "#0E1013",
        },
        paper: "#FFFFFF",
      },
      boxShadow: {
        // Layered and cool-tinted: one tight contact shadow plus one soft cast,
        // so a card reads as sitting on the canvas rather than glowing above it.
        "security-card": "0 1px 2px 0 rgb(23 26 31 / 0.05), 0 1px 3px -1px rgb(23 26 31 / 0.06)",
        "security-card-hover": "0 2px 4px -1px rgb(23 26 31 / 0.07), 0 6px 14px -6px rgb(23 26 31 / 0.12)",
        "security-elevated": "0 4px 8px -3px rgb(23 26 31 / 0.08), 0 18px 32px -14px rgb(23 26 31 / 0.22)",
      },
      borderWidth: {
        "wireframe-thin": "1px",
        "wireframe-thick": "2px",
      },
      borderRadius: {
        security: "0.5rem",
        "security-lg": "0.875rem",
      },
      animation: {
        "fade-in": "fadeIn 0.24s cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-up": "slideUp 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
        "signal-pulse": "signalPulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        signalPulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
    },
  },
  plugins: [],
};

module.exports = config;
