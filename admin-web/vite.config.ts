/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const backend = process.env.SIGNGUARD_BACKEND ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // redirect.html is MSAL's redirect bridge page (Entra sign-in), built as its own small page.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        redirect: fileURLToPath(new URL("./redirect.html", import.meta.url)),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  server: {
    port: 5173,
    proxy: { "/api": backend, "/verify": backend },
  },
});
