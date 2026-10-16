import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.sstlibrary.app",
  appName: "SST Library",
  webDir: "public",
  server: {
    // If SITE_URL is provided, load the live server in WebView with native streaming
    url: process.env.SITE_URL || undefined,
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
