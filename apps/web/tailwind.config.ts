import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    "bg-green-100",
    "border-green-500",
    "text-green-700",
    "bg-red-100",
    "border-red-500",
    "text-red-700",
    "bg-yellow-100",
    "text-yellow-700",
    "border-yellow-500",
    {
      pattern: /delay-(100|200|300|500)/,
    },
  ],
  darkMode: "class",
  theme: {
    extend: {
      boxShadow: {
        "custom-shadow": "0px 1px 2px 0px #0000000D",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [require("@tailwindcss/forms"), require("tailwind-scrollbar-hide")],
};
export default config;
