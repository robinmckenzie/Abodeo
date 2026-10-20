// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readAccountConfig } from "./account-config.server";

const shared = {
  BETTER_AUTH_SECRET: "secret",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
};

const production = {
  ...shared,
  VERCEL_ENV: "production",
  BETTER_AUTH_URL: "https://abodeo-kappa.vercel.app",
  DATABASE_URL: "postgres://production",
};

const local = {
  ...shared,
  BETTER_AUTH_URL: "http://localhost:5173",
  AUTH_DATABASE_URL: "postgres://local",
};

describe("readAccountConfig", () => {
  it("uses production's store only in production", () => {
    expect(readAccountConfig(production, false)).toEqual(
      expect.objectContaining({
        deployment: "production",
        databaseUrl: "postgres://production",
        baseUrl: "https://abodeo-kappa.vercel.app",
      }),
    );
  });

  it("uses the local store in development, never production's", () => {
    expect(readAccountConfig(local, true)).toEqual(
      expect.objectContaining({
        deployment: "local",
        databaseUrl: "postgres://local",
        baseUrl: "http://localhost:5173",
      }),
    );
    expect(
      readAccountConfig(
        {
          ...local,
          AUTH_DATABASE_URL: undefined,
          DATABASE_URL: "postgres://production",
        },
        true,
      ),
    ).toBeUndefined();
  });

  it("treats the development server as local, whatever VERCEL_ENV says", () => {
    expect(readAccountConfig({ ...production, ...local }, true)).toEqual(
      expect.objectContaining({ databaseUrl: "postgres://local" }),
    );
  });

  it("has no sign-in on a preview", () => {
    expect(
      readAccountConfig({ ...production, VERCEL_ENV: "preview" }, false),
    ).toBeUndefined();
  });

  it("is not configured when a setting is missing or blank", () => {
    for (const name of Object.keys(production)) {
      if (name === "VERCEL_ENV") continue;
      expect(
        readAccountConfig({ ...production, [name]: " " }, false),
      ).toBeUndefined();
    }
  });

  it("needs an https address in production", () => {
    expect(
      readAccountConfig(
        { ...production, BETTER_AUTH_URL: "http://abodeo-kappa.vercel.app" },
        false,
      ),
    ).toBeUndefined();
  });
});
