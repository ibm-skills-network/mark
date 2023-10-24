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
    "bottom-[1.5rem]",
    "left-[1.5rem]",
    "bottom-[2rem]",
    "left-[2rem]",
    "bottom-[2.5rem]",
    "left-[2.5rem]",
    "bottom-[3rem]",
    "left-[3rem]",
    {
      pattern: /delay-(100|200|300|500)/,
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
