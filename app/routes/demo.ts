// The address /demo, from the link in Robin's CV: signs the visitor in as the
// demo account and shows the projects page. A resource route, as it has no
// component, so the server returns its redirect as it is.
import type { Route } from "./+types/demo";
import { handleDemoRequest } from "../account/account-handler.server";

export function loader({ request }: Route.LoaderArgs) {
  return handleDemoRequest(request);
}

export function action({ request }: Route.ActionArgs) {
  return handleDemoRequest(request);
}
