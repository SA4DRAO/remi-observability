import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("@tanstack/react-query")) return "query";
          if (id.includes("@radix-ui/")) return "radix";
        },
      },
    },
  },
  preview: {
    port: 4173,
    open: false,
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV === "development"),
  },
});
