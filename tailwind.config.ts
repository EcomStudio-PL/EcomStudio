import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        sunken: "rgb(var(--sunken) / <alpha-value>)",
        sidebar: "rgb(var(--sidebar) / <alpha-value>)",
        float: "rgb(var(--float) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        "line-strong": "rgb(var(--line-strong) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-hover) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        accent2: "rgb(var(--accent2) / <alpha-value>)",
        indigo: "rgb(var(--indigo) / <alpha-value>)",
        "accent2-soft": "rgb(var(--accent2-soft) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-body)"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem", "3xl": "1.5rem" },
      boxShadow: {
        e1: "var(--shadow-1)", e2: "var(--shadow-2)", e3: "var(--shadow-3)", e4: "var(--shadow-4)",
      },
    },
  },
  plugins: [],
};
export default config;
