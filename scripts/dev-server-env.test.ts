import { describe, expect, it } from "vitest";
import {
  buildDevServerEnv,
  DEFAULT_API_PORT,
  DEFAULT_API_URL,
  DEFAULT_WEB_PORT,
} from "./dev-server-env.js";

describe("buildDevServerEnv", () => {
  it("defaults web to 3000 and api to 3001 with no overrides", () => {
    const env = buildDevServerEnv({});
    expect(env.WEB_PORT).toBe(DEFAULT_WEB_PORT);
    expect(env.API_PORT).toBe(DEFAULT_API_PORT);
    expect(env.WEB_PORT).toBe("3000");
    expect(env.API_PORT).toBe("3001");
  });

  it("strips the ambient PORT so both servers cannot bind the same value", () => {
    const env = buildDevServerEnv({ PORT: "3001", PATH: "/usr/bin" });
    expect(env.PORT).toBeUndefined();
    expect(env.WEB_PORT).toBe("3000");
    expect(env.API_PORT).toBe("3001");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("defaults the web api url to the local api server", () => {
    const env = buildDevServerEnv({});
    expect(env.NEXT_PUBLIC_API_URL).toBe(DEFAULT_API_URL);
    expect(env.NEXT_PUBLIC_API_URL).toBe("http://localhost:3001");
  });

  it("respects explicit WEB_PORT, API_PORT and NEXT_PUBLIC_API_URL overrides", () => {
    const env = buildDevServerEnv({
      WEB_PORT: "3100",
      API_PORT: "3200",
      NEXT_PUBLIC_API_URL: "https://api.example.com",
    });
    expect(env.WEB_PORT).toBe("3100");
    expect(env.API_PORT).toBe("3200");
    expect(env.NEXT_PUBLIC_API_URL).toBe("https://api.example.com");
  });

  it("keeps the database url for downstream apps", () => {
    const env = buildDevServerEnv({
      DATABASE_URL: "postgres://postgres:pw@localhost:5432/postgres",
    });
    expect(env.DATABASE_URL).toBe("postgres://postgres:pw@localhost:5432/postgres");
  });
});
