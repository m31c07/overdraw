import basicSsl from "@vitejs/plugin-basic-ssl";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

function resolveHttpsConfig() {
  const certPath = process.env.VITE_HTTPS_CERT;
  const keyPath = process.env.VITE_HTTPS_KEY;

  if (certPath && keyPath) {
    return {
      cert: fs.readFileSync(path.resolve(certPath)),
      key: fs.readFileSync(path.resolve(keyPath))
    };
  }

  return true;
}

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: "0.0.0.0",
    https: resolveHttpsConfig()
  },
  preview: {
    host: "0.0.0.0",
    https: resolveHttpsConfig()
  }
});
