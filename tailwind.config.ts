import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        rise: "#16a34a",
        fall: "#dc2626",
        panel: "#111827",
        panel2: "#1a2332",
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        flashGreen: {
          "0%": { backgroundColor: "rgba(22,163,74,0.35)" },
          "100%": { backgroundColor: "transparent" },
        },
        flashRed: {
          "0%": { backgroundColor: "rgba(220,38,38,0.35)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
        flashGreen: "flashGreen 1s ease-out",
        flashRed: "flashRed 1s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
