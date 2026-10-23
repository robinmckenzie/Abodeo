// A stand-in for the browser's XMLHttpRequest that sends through the global
// fetch, so that a test's fake server answers uploads as it does everything
// else (AD #54 Change UX While Dropped Images Are Added). It reports no
// progress.
export class FetchBackedXhr {
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  timeout = 0;
  withCredentials = false;
  responseType = "";
  status = 0;
  response: ArrayBuffer | null = null;
  private method = "GET";
  private path = "";
  private headers: Record<string, string> = {};

  open(method: string, path: string) {
    this.method = method;
    this.path = path;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: BodyInit) {
    void fetch(this.path, {
      method: this.method,
      headers: this.headers,
      body,
    }).then(
      async (response) => {
        this.status = response.status;
        this.response = await response.arrayBuffer();
        this.onload?.();
      },
      () => this.onerror?.(),
    );
  }
}
