import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    // บรรทัดนี้แหละครับที่สำคัญ! มันจะบอกให้ Tailwind เข้าไปค้นหาโค้ดในโฟลเดอร์ src
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;