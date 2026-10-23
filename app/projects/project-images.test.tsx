import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleImagesRequest } from "./image-handler.server";
import { maxCaptionLength } from "./images-api";
import { ImageViewer, ProjectImages, type AddFiles } from "./project-images";
import { createMemoryImageStore } from "./test-image-store.server";
import { makeJpeg, makePng } from "./test-images";

// The browser's own picture decoding is not available here.
vi.mock("./thumbnail", () => ({
  browserThumbnailEnvironment: {},
  makeThumbnail: vi.fn(
    async () => new Blob([makeJpeg(500)], { type: "image/jpeg" }),
  ),
}));

type Server = {
  session: string | null;
  store: ReturnType<typeof createMemoryImageStore>;
  // Loses the answer of the next upload, after the server has handled it.
  loseNextUploadAnswer: boolean;
  calls: string[];
};

function fakeServer() {
  const server: Server = {
    session: "ada",
    store: createMemoryImageStore(),
    loseNextUploadAnswer: false,
    calls: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      server.calls.push(`${init.method ?? "GET"} ${path}`);
      const headers = new Headers(init.headers);
      if (server.session) headers.set("cookie", server.session);
      const answer = await handleImagesRequest(
        new Request(`http://localhost${path}`, {
          method: init.method,
          headers,
          body: init.body,
        }),
        {
          readSessionUserId: async (given) => given.get("cookie") ?? undefined,
          store: server.store.store,
          reportFailure: () => {},
        },
      );
      if (server.loseNextUploadAnswer && init.method === "POST") {
        server.loseNextUploadAnswer = false;
        throw new TypeError("network lost");
      }
      return answer;
    }),
  );
  return server;
}

let createdUrls: string[] = [];
let revokedUrls: string[] = [];

beforeEach(() => {
  createdUrls = [];
  revokedUrls = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void revokedUrls.push(url));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pngFile(name = "porch.png") {
  return new File([makePng()], name, { type: "image/png" });
}

async function seed(server: Server, userId: string, ids: string[]) {
  for (const id of ids) {
    await server.store.store.upload(
      userId,
      "shed",
      id,
      "image/png",
      Buffer.from(makePng()),
      Buffer.from(makeJpeg(500)),
    );
  }
}

function chooseFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  fireEvent.change(input, { target: { files } });
}

describe("ProjectImages", () => {
  it("says to sign in, in place of the button, when signed out", () => {
    render(<ProjectImages accountId={null} projectId="shed" />);
    expect(screen.getByText("Sign in to add images")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add image/i })).toBeNull();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("shows the images oldest first with the time added, and their thumbnails", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one", "two"]);
    render(<ProjectImages accountId="ada" projectId="shed" />);
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry img")).toHaveLength(2),
    );
    const entries = [...document.querySelectorAll(".image-entry")];
    expect(entries.map((entry) => entry.getAttribute("data-image-id"))).toEqual(
      ["one", "two"],
    );
    expect(entries[0].querySelector("time")?.textContent).not.toBe("");
    expect(entries[0].querySelector("img")?.getAttribute("src")).toMatch(
      /^blob:/,
    );
  });

  it("adds a chosen image to the bottom, using the thumbnail made here", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    render(<ProjectImages accountId="ada" projectId="shed" />);
    await screen.findByRole("button", { name: "Add image" });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add image" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    chooseFiles([pngFile()]);
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry")).toHaveLength(2),
    );
    expect(server.store.accounts.get("ada")).toHaveLength(2);
    // No thumbnail was fetched for the image just added.
    const fetched = server.calls.filter((call) => call.includes("/thumbnail"));
    expect(fetched).toHaveLength(1);
  });

  it("refuses what is not an image, by its content, and adds the rest", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    const onMessage = vi.fn();
    render(
      <ProjectImages accountId="ada" projectId="shed" onMessage={onMessage} />,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add image" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    const renamed = new File(["GIF89a......"], "holiday.png", {
      type: "image/png",
    });
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "huge.jpg");
    chooseFiles([renamed, pngFile("good.png"), big]);
    await waitFor(() => expect(onMessage).toHaveBeenCalledTimes(2));
    expect(document.querySelectorAll(".image-entry")).toHaveLength(2);
    expect(document.querySelectorAll(".image-pending-entry")).toHaveLength(0);
    expect(onMessage).toHaveBeenCalledWith(
      "holiday.png: Sorry, only JPEG and PNG images can be added.",
    );
    // The size is checked after the type, so a large non-image is a format
    // problem, and a large image is a size problem.
    expect(onMessage.mock.calls[1][0]).toContain("huge.jpg");
    expect(onMessage.mock.calls.flat().join()).not.toContain("good.png");
    expect(server.store.accounts.get("ada")).toHaveLength(2);
    // The messages float, so none is left in the Images section.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("refuses an image over 4 MiB as too large", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    const onMessage = vi.fn();
    render(
      <ProjectImages accountId="ada" projectId="shed" onMessage={onMessage} />,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add image" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    chooseFiles([new File([makePng(4 * 1024 * 1024 + 1)], "huge.png")]);
    await waitFor(() =>
      expect(onMessage).toHaveBeenCalledWith(
        "huge.png: Sorry, your image is too large.",
      ),
    );
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("shows a placeholder with the file's name for each file being added, in the images' place", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    render(<ProjectImages accountId="ada" projectId="shed" />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add image" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    const bad = new File(["GIF89a......"], "bad.png", { type: "image/png" });
    chooseFiles([pngFile("first.png"), bad, pngFile("second.png")]);
    // At once, one for every file, in drop order, after the existing image.
    expect(screen.getByRole("button", { name: "Adding images" })).toBeTruthy();
    expect(
      [...document.querySelectorAll(".image-pending-entry")].map((entry) =>
        entry.getAttribute("aria-label"),
      ),
    ).toEqual(["Adding first.png", "Adding bad.png", "Adding second.png"]);
    expect(screen.getByText("second.png")).toBeTruthy();
    expect(screen.getAllByText(/^\(\d+ B\)$/)).toHaveLength(3);
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry")).toHaveLength(3),
    );
    expect(document.querySelectorAll(".image-pending-entry")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
  });

  it("removes the placeholders and says so when a file cannot be read after it was checked", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    const onMessage = vi.fn();
    render(
      <ProjectImages accountId="ada" projectId="shed" onMessage={onMessage} />,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add image" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    const broken = pngFile("broken.png");
    broken.arrayBuffer = () => Promise.reject(new Error("gone"));
    chooseFiles([broken, pngFile("after.png")]);
    await waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll(".image-pending-entry")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
  });

  it("runs files added while others are being added after them, in order", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    const addFilesRef: { current: AddFiles | null } = { current: null };
    render(
      <ProjectImages
        accountId="ada"
        projectId="shed"
        addFilesRef={addFilesRef}
      />,
    );
    await waitFor(() => expect(addFilesRef.current).not.toBeNull());
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add image" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    act(() => {
      addFilesRef.current!([pngFile("a.png")]);
      addFilesRef.current!([pngFile("b.png")]);
    });
    expect(document.querySelectorAll(".image-pending-entry")).toHaveLength(2);
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry")).toHaveLength(3),
    );
    expect(document.querySelectorAll(".image-pending-entry")).toHaveLength(0);
    expect(server.store.accounts.get("ada")).toHaveLength(3);
  });

  it("gives one image when an upload's answer is lost and it is sent again", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    render(<ProjectImages accountId="ada" projectId="shed" />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add image" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    server.loseNextUploadAnswer = true;
    chooseFiles([pngFile()]);
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry")).toHaveLength(2),
    );
    expect(server.store.accounts.get("ada")).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("adds files given by the dashboard, as when dropped", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    const addFilesRef: { current: AddFiles | null } = { current: null };
    render(
      <ProjectImages
        accountId="ada"
        projectId="shed"
        addFilesRef={addFilesRef}
      />,
    );
    await waitFor(() => expect(addFilesRef.current).not.toBeNull());
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry")).toHaveLength(1),
    );
    act(() => addFilesRef.current!([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry")).toHaveLength(3),
    );
  });

  describe("another account", () => {
    it("shows nothing of the earlier account, and lets go of its blob URLs", async () => {
      const server = fakeServer();
      await seed(server, "ada", ["one"]);
      const { rerender } = render(
        <ProjectImages accountId="ada" projectId="shed" />,
      );
      await waitFor(() =>
        expect(document.querySelectorAll(".image-entry img")).toHaveLength(1),
      );
      server.session = "bob";
      rerender(<ProjectImages accountId="bob" projectId="shed" />);
      expect(document.querySelectorAll(".image-entry")).toHaveLength(0);
      expect(document.querySelectorAll("img")).toHaveLength(0);
      expect(revokedUrls).toEqual(createdUrls);
      await waitFor(() =>
        expect(screen.queryByText("Loading images…")).toBeNull(),
      );
      expect(document.querySelectorAll(".image-entry")).toHaveLength(0);
    });

    it("drops a thumbnail that arrives after the account changed, and makes no blob URL for it", async () => {
      const server = fakeServer();
      await seed(server, "ada", ["one"]);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const realFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, init?: RequestInit) => {
          const answer = await realFetch(path, init);
          if (path.endsWith("/thumbnail")) await gate;
          return answer;
        }),
      );
      const { rerender } = render(
        <ProjectImages accountId="ada" projectId="shed" />,
      );
      await waitFor(() =>
        expect(document.querySelectorAll(".image-entry")).toHaveLength(1),
      );
      await waitFor(() =>
        expect(
          vi
            .mocked(fetch)
            .mock.calls.some(([path]) => String(path).endsWith("/thumbnail")),
        ).toBe(true),
      );
      server.session = "bob";
      rerender(<ProjectImages accountId="bob" projectId="shed" />);
      release();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(createdUrls).toEqual([]);
      expect(document.querySelectorAll("img")).toHaveLength(0);
    });

    it("drops a list that arrives after the account changed", async () => {
      const server = fakeServer();
      await seed(server, "ada", ["one"]);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const realFetch = globalThis.fetch;
      let first = true;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, init?: RequestInit) => {
          const answer = await realFetch(path, init);
          if (first) {
            first = false;
            await gate;
          }
          return answer;
        }),
      );
      const { rerender } = render(
        <ProjectImages accountId="ada" projectId="shed" />,
      );
      server.session = "bob";
      rerender(<ProjectImages accountId="bob" projectId="shed" />);
      release();
      await waitFor(() =>
        expect(screen.queryByText("Loading images…")).toBeNull(),
      );
      expect(document.querySelectorAll(".image-entry")).toHaveLength(0);
    });
  });

  describe("captions", () => {
    async function renderOne() {
      const server = fakeServer();
      await seed(server, "ada", ["one"]);
      render(<ProjectImages accountId="ada" projectId="shed" />);
      const box = (await screen.findByRole("textbox", {
        name: "Caption",
      })) as HTMLTextAreaElement;
      return { server, box };
    }

    it("saves a caption when leaving the box, and shows it again", async () => {
      const { server, box } = await renderOne();
      fireEvent.change(box, { target: { value: "Before painting" } });
      fireEvent.blur(box);
      await waitFor(() =>
        expect(server.store.accounts.get("ada")![0].image.caption).toBe(
          "Before painting",
        ),
      );
      expect(box.value).toBe("Before painting");
    });

    it("keeps text typed while a caption is saving", async () => {
      const { server, box } = await renderOne();
      fireEvent.change(box, { target: { value: "Before" } });
      fireEvent.blur(box);
      fireEvent.change(box, { target: { value: "Before painting" } });
      await waitFor(() =>
        expect(server.store.accounts.get("ada")![0].image.caption).toBe(
          "Before",
        ),
      );
      expect(box.value).toBe("Before painting");
    });

    it("does not send a caption over 500 characters, and says why", async () => {
      const { server, box } = await renderOne();
      fireEvent.change(box, {
        target: { value: "😀".repeat(maxCaptionLength + 1) },
      });
      fireEvent.blur(box);
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Sorry, a caption can be up to 500 characters.",
      );
      expect(server.calls.some((call) => call.startsWith("PATCH"))).toBe(false);
    });

    it("accepts exactly 500 characters", async () => {
      const { server, box } = await renderOne();
      fireEvent.change(box, {
        target: { value: "😀".repeat(maxCaptionLength) },
      });
      fireEvent.blur(box);
      await waitFor(() =>
        expect(server.store.accounts.get("ada")![0].image.caption).toHaveLength(
          maxCaptionLength * 2,
        ),
      );
    });

    it("keeps the caption saved elsewhere and says it changed", async () => {
      const { server, box } = await renderOne();
      const stored = server.store.accounts.get("ada")![0];
      stored.image = { ...stored.image, caption: "From my phone" };
      fireEvent.change(box, { target: { value: "From my laptop" } });
      fireEvent.blur(box);
      expect((await screen.findByRole("alert")).textContent).toContain(
        "This caption was changed on another device.",
      );
      await waitFor(() => expect(box.value).toBe("From my phone"));
      expect(stored.image.caption).toBe("From my phone");
    });
  });

  it("tells the newest image's id once loaded, and as images are added and removed", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one", "two"]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onLatestImageChange = vi.fn();
    render(
      <ProjectImages
        accountId="ada"
        projectId="shed"
        onLatestImageChange={onLatestImageChange}
      />,
    );
    await waitFor(() =>
      expect(onLatestImageChange).toHaveBeenCalledWith("two"),
    );
    expect(onLatestImageChange).not.toHaveBeenCalledWith(null);

    chooseFiles([pngFile()]);
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry")).toHaveLength(3),
    );
    const added = document
      .querySelectorAll(".image-entry")[2]
      .getAttribute("data-image-id");
    expect(onLatestImageChange).toHaveBeenLastCalledWith(added);

    const removes = screen.getAllByRole("button", { name: "Remove image" });
    fireEvent.click(removes[2]);
    await waitFor(() =>
      expect(onLatestImageChange).toHaveBeenLastCalledWith("two"),
    );
  });

  describe("full-size view", () => {
    const viewerImage = () =>
      document.querySelector<HTMLImageElement>(".image-viewer img");
    const step = (name: string) =>
      document.querySelector<HTMLButtonElement>(
        `.image-viewer [aria-label="${name}"]`,
      );

    it("steps through the images with previous and next buttons, stopping at the ends", async () => {
      const server = fakeServer();
      await seed(server, "ada", ["one", "two", "three"]);
      render(<ProjectImages accountId="ada" projectId="shed" />);
      const views = await screen.findAllByRole("button", {
        name: /View full size/,
      });
      fireEvent.click(views[1]);
      await waitFor(() => expect(viewerImage()).not.toBeNull());
      const middle = viewerImage()!.getAttribute("src");
      expect(step("Previous image")!.hasAttribute("aria-disabled")).toBe(false);
      expect(step("Next image")!.hasAttribute("aria-disabled")).toBe(false);

      fireEvent.click(step("Next image")!);
      await waitFor(() =>
        expect(viewerImage()!.getAttribute("src")).not.toBe(middle),
      );
      expect(step("Next image")!.hasAttribute("aria-disabled")).toBe(true);
      expect(step("Previous image")!.hasAttribute("aria-disabled")).toBe(false);

      fireEvent.click(step("Previous image")!);
      await waitFor(() =>
        expect(viewerImage()!.getAttribute("src")).toBe(middle),
      );
      fireEvent.click(step("Previous image")!);
      await waitFor(() =>
        expect(step("Previous image")!.hasAttribute("aria-disabled")).toBe(
          true,
        ),
      );
      expect(viewerImage()).not.toBeNull();
    });

    it("stays closed when dismissed while the next image is still loading", async () => {
      const server = fakeServer();
      await seed(server, "ada", ["one", "two"]);
      render(<ProjectImages accountId="ada" projectId="shed" />);
      const views = await screen.findAllByRole("button", {
        name: /View full size/,
      });
      fireEvent.click(views[0]);
      await waitFor(() => expect(viewerImage()).not.toBeNull());

      fireEvent.click(step("Next image")!);
      fireEvent.click(document.querySelector("dialog")!);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(document.querySelector(".image-viewer")).toBeNull();
    });

    it("has no step buttons when the project has one image", async () => {
      const server = fakeServer();
      await seed(server, "ada", ["one"]);
      render(<ProjectImages accountId="ada" projectId="shed" />);
      fireEvent.click(
        await screen.findByRole("button", { name: /View full size/ }),
      );
      await waitFor(() => expect(viewerImage()).not.toBeNull());
      expect(step("Previous image")).toBeNull();
      expect(step("Next image")).toBeNull();
    });
  });

  it("removes an image after confirming", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one", "two"]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProjectImages accountId="ada" projectId="shed" />);
    const [first] = await screen.findAllByRole("button", {
      name: "Remove image",
    });
    fireEvent.click(first);
    await waitFor(() =>
      expect(document.querySelectorAll(".image-entry")).toHaveLength(1),
    );
    expect(server.store.accounts.get("ada")).toHaveLength(1);
    expect(document.querySelector("[data-image-id=one]")).toBeNull();
  });

  it("keeps an image when the person does not confirm", async () => {
    const server = fakeServer();
    await seed(server, "ada", ["one"]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ProjectImages accountId="ada" projectId="shed" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove image" }),
    );
    expect(server.store.accounts.get("ada")).toHaveLength(1);
  });

  it("tells the dashboard when the sign-in has changed", async () => {
    const server = fakeServer();
    server.session = null;
    const onFailure = vi.fn();
    render(
      <ProjectImages accountId="ada" projectId="shed" onFailure={onFailure} />,
    );
    await waitFor(() => expect(onFailure).toHaveBeenCalledWith("signed-out"));
    expect(await screen.findByText(/cannot reach your images/)).toBeTruthy();
  });

  it("stays open when its effect runs twice, as in development", async () => {
    // jsdom has no modal dialogs, so this does what a browser does: closing
    // sends a close event after a moment, even if it was opened again.
    const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      setTimeout(() => this.dispatchEvent(new Event("close")), 0);
    };
    const onClose = vi.fn();
    render(
      <StrictMode>
        <ImageViewer url="blob:x" label="Porch" onClose={onClose} />
      </StrictMode>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onClose).not.toHaveBeenCalled();
    delete proto.showModal;
    delete proto.close;
  });

  it("shows the caption and the time added below the image", () => {
    const { container } = render(
      <ImageViewer
        url="blob:x"
        label="Porch"
        caption="Front porch"
        createdAt="2026-10-22T10:30:00Z"
        onClose={() => {}}
      />,
      { container: document.body.appendChild(document.createElement("div")) },
    );
    const details = container.querySelector(".image-viewer-details");
    expect(details?.firstElementChild?.textContent).toBe("Front porch");
    expect(details?.lastElementChild?.tagName).toBe("TIME");
    expect(details?.lastElementChild?.getAttribute("datetime")).toBe(
      "2026-10-22T10:30:00Z",
    );
  });
});
