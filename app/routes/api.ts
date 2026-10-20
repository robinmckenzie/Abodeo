// Every address under /api, answered by the account code: Better Auth's
// sign-in endpoints, sign-in's status and the profile. A resource route, as
// it has no component, so the server runs it for any method and returns its
// response as it is.
import type { Route } from "./+types/api";
import { handleAccountRequest } from "../account/account-handler.server";

export function loader({ request }: Route.LoaderArgs) {
  return handleAccountRequest(request);
}

export function action({ request }: Route.ActionArgs) {
  return handleAccountRequest(request);
}
