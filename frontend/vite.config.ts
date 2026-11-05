import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.FINANCE_WEB_BASE || "/finance/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.PLATFORM_API_TARGET || "http://127.0.0.1:18080",
      },
    },
  },
});
