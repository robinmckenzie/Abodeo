// Reads a JSON request body no larger than a byte limit, for the projects and
// people endpoints (AD #130). Each endpoint keeps its own Content-Type check,
// limits and responses.

// The body as JSON, undefined if it cannot be read or is not JSON, or
// "too-large" if it is over the limit, whether or not its length was declared.
export async function readJsonBody(request: Request, limit: number) {
  const length = Number(request.headers.get("Content-Length"));
  if (length > limit) return "too-large" as const;
  let buffer: ArrayBuffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return undefined;
  }
  if (buffer.byteLength > limit) return "too-large" as const;
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } catch {
    return undefined;
  }
}
