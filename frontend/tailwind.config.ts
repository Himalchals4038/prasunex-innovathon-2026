import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: { colors: { ink: "#17211c", muted: "#768078", paper: "#f7f8f6", forest: "#173e32", lime: "#ccf278", line: "#e8ece7" }, fontFamily: { sans: ["Arial", "sans-serif"] }, boxShadow: { soft: "0 12px 38px rgba(27,46,35,.07)" } } },
  plugins: [],
};
export default config;
