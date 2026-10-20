import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

// As in app/projects/default-projects.ts, which this file does not import,
// as Vite's config is loaded on its own.
const defaultProjectsEndpoint = "/__abodeo/default-projects";

// The settings sign-in reads in development, from .env.local. DATABASE_URL,
// production's account store, is never loaded.
const localAccountVariables = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_DATABASE_URL",
];

export default defineConfig({
  plugins: [reactRouter(), saveDefaultProjects(), loadLocalAccountSettings()],
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

// Lets the dashboard's development panel save the projects as the defaults,
// by writing default-projects.json. Only the development server has it, not
// the deployed app. It accepts only JSON sent by a page from the server's own
// address, so that another site open in the browser cannot write the file.
function saveDefaultProjects(): Plugin {
  const maxBytes = 5 * 1024 * 1024;
  // Saves take turns, as two at once can fail to replace the same file.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    name: "abodeo-save-default-projects",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(defaultProjectsEndpoint, async (req, res) => {
        const reply = (status: number, text: string) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(text);
        };
        if (req.method !== "POST") return reply(405, "Use POST.");
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          return reply(415, "Send JSON.");
        }
        if (!isSameOrigin(req.headers.origin, req.headers.host)) {
          return reply(403, "Only this server's pages can save defaults.");
        }
        try {
          // Decoded once it has all arrived, as a chunk can end part way
          // through a character.
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > maxBytes) return reply(413, "Too large.");
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks).toString("utf8");
          // Loaded through the development server, like the app's code.
          const {
            buildDefaultProjectsFile,
            defaultProjectsPath,
            readDefaultProjects,
          } = (await server.ssrLoadModule(
            "/app/projects/default-projects.ts",
          )) as typeof import("./app/projects/default-projects");
          let defaults;
          try {
            defaults = readDefaultProjects(JSON.parse(body));
          } catch {
            defaults = null;
          }
          if (!defaults) return reply(400, "The projects could not be read.");
          const target = path.resolve(server.config.root, defaultProjectsPath);
          const file = buildDefaultProjectsFile(defaults.projects);
          const text = `${JSON.stringify(file, null, 2)}\n`;
          const write = queue.then(() => replaceFile(target, text));
          queue = write.catch(() => {});
          await write;
          reply(200, "Saved.");
        } catch (error) {
          if (!res.headersSent) reply(500, `Not saved: ${error}`);
        }
      });
    },
  };
}

// Writes the file in full under a name of its own first, so that an
// interrupted save cannot leave it half written.
async function replaceFile(target: string, text: string) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function isSameOrigin(origin: string | undefined, host: string | undefined) {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.host === host
      : false;
  } catch {
    return false;
  }
}
