import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // The left-hand column and the account, shared by every screen.
  layout("routes/app-layout.tsx", [
    route("projects", "routes/projects.tsx"),
    route("people", "routes/people.tsx"),
    route("bin", "routes/bin.tsx"),
  ]),
  route("api/*", "routes/api.ts"),
] satisfies RouteConfig;
