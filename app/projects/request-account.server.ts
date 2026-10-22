// Who a projects or images request is for, shared by both handlers: the
// account comes only from the sign-in session. The page also names the
// account it is working for, and a request naming another is refused.
import type { ReadSessionUserId } from "../account/account-profile.server";
import { withTimeout } from "../account/account-profile.server";
import { accountHeader } from "./projects-api";

export type RequestAccount =
  | { kind: "account"; userId: string }
  | {
      kind: "refused";
      status: 400 | 401 | 409;
      error: "invalid_request" | "not_signed_in" | "account_changed";
    };

export async function readRequestAccount(
  request: Request,
  readSessionUserId: ReadSessionUserId,
  timeout: number,
): Promise<RequestAccount> {
  const pageAccount = request.headers.get(accountHeader);
  if (!pageAccount) {
    return { kind: "refused", status: 400, error: "invalid_request" };
  }
  const userId = await withTimeout(readSessionUserId(request.headers), timeout);
  if (userId === undefined) {
    return { kind: "refused", status: 401, error: "not_signed_in" };
  }
  if (pageAccount !== userId) {
    return { kind: "refused", status: 409, error: "account_changed" };
  }
  return { kind: "account", userId };
}
