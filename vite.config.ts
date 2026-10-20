import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin } from "vite";

// As in app/projects/default-projects.ts, which this file does not import,
// as Vite's config is loaded on its own.
const defaultProjectsEndpoint = "/__abodeo/default-projects";

export default defineConfig({
  plugins: [reactRouter(), saveDefaultProjects()],
  resolve: {
    tsconfigPaths: true,
  },
});

// Lets the dashboard's development panel save the projects as the defaults,
// by writing default-projects.json. Only the development server has it, not
// the deployed app. It accepts only JSON sent by a page from the server's own
// address, so that another site open in the browser cannot write the file.
function saveDefaultProjects(): Plugin {
  const maxLength = 5 * 1024 * 1024;
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
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > maxLength) return reply(413, "Too large.");
        }
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
        // Written in full to a temporary file first, so that an interrupted
        // save cannot leave the defaults half written.
        const target = path.resolve(server.config.root, defaultProjectsPath);
        const temporary = `${target}.tmp`;
        const file = buildDefaultProjectsFile(defaults.projects);
        await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`);
        await rename(temporary, target);
        reply(200, "Saved.");
      });
    },
  };
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
