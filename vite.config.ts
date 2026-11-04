import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

// The settings sign-in reads in development, from .env.local. DATABASE_URL,
// production's account store, is never loaded.
const localAccountVariables = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_DATABASE_URL",
  // AD #94: the email about a visit. Optional.
  "RESEND_API_KEY",
  "VISIT_ALERT_TO",
  "VISIT_ALERT_FROM",
  "VISIT_ALERT_IGNORE_LABELS",
  "VISIT_ALERT_COOLDOWN_MINUTES",
  "VISIT_ALERT_HOURLY_LIMIT",
];

export default defineConfig({
  plugins: [reactRouter(), loadLocalAccountSettings()],
  resolve: {
    tsconfigPaths: true,
  },
});

// Gives the development server's sign-in code its settings from the .env
// files, which Vite otherwise passes only to browser code, and only with its
// VITE_ prefix. A variable already set in the shell is kept.
function loadLocalAccountSettings(): Plugin {
  return {
    name: "abodeo-local-account-settings",
    apply: "serve",
    configResolved(config) {
      if (config.envDir === false) return;
      const env = loadEnv(config.mode, config.envDir, localAccountVariables);
      for (const name of localAccountVariables) {
        if (env[name] !== undefined && process.env[name] === undefined) {
          process.env[name] = env[name];
        }
      }
    },
  };
}
