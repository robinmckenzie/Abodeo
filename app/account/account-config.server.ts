// Decides whether sign-in can run here, and with which account store.
// Production uses DATABASE_URL. Anywhere else uses AUTH_DATABASE_URL, which
// points to the separate abodeo-local database, and never falls back to
// DATABASE_URL, so that accounts made locally can never reach production's
// store. Vercel previews have no sign-in.

type Environment = Record<string, string | undefined>;

export type AccountDeployment = "production" | "preview" | "local";

export type AccountConfig = {
  deployment: AccountDeployment;
  databaseUrl: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  // The app's address, such as https://abodeo-kappa.vercel.app, or the
  // development server's.
  baseUrl: string;
};

function read(env: Environment, name: string) {
  return env[name]?.trim() || undefined;
}

// The development server always counts as local, whatever VERCEL_ENV says.
export function readAccountDeployment(
  env: Environment,
  isDevelopmentServer: boolean,
): AccountDeployment {
  if (isDevelopmentServer) return "local";
  const vercelEnv = read(env, "VERCEL_ENV");
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";
  return "local";
}

// The sign-in settings, or undefined when sign-in is not fully configured
// here, and always on a preview. No setting's name or value is ever reported.
export function readAccountConfig(
  env: Environment,
  isDevelopmentServer: boolean,
): AccountConfig | undefined {
  const deployment = readAccountDeployment(env, isDevelopmentServer);
  if (deployment === "preview") return undefined;
  const databaseUrl = read(
    env,
    deployment === "production" ? "DATABASE_URL" : "AUTH_DATABASE_URL",
  );
  const secret = read(env, "BETTER_AUTH_SECRET");
  const clientId = read(env, "GOOGLE_CLIENT_ID");
  const clientSecret = read(env, "GOOGLE_CLIENT_SECRET");
  const baseUrl = readOrigin(
    read(env, "BETTER_AUTH_URL"),
    deployment === "production",
  );
  if (!databaseUrl || !secret || !clientId || !clientSecret || !baseUrl) {
    return undefined;
  }
  return {
    deployment,
    databaseUrl,
    secret,
    google: { clientId, clientSecret },
    baseUrl,
  };
}

// Production's address must use https. Locally it is http://localhost:5173.
function readOrigin(value: string | undefined, isProduction: boolean) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.origin;
    return url.protocol === "http:" && !isProduction ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
