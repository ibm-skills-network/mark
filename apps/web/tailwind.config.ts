import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    // for the tooltip
    "bottom-[0rem]",
    "left-[0rem]",
    "bottom-[1rem]",
    "left-[1rem]",
    "bottom-[2rem]",
    "left-[2rem]",
    {
      pattern: /delay-(100|200|300|500)/,
      variants: [],
    },
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
export default config;
