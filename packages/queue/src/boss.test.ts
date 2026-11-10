import { expect, it, vi } from "vitest";
import { createPgBoss } from "./boss.js";

it("keeps personal data in pg-boss errors out of the log stream", () => {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    const boss = createPgBoss({ connectionString: "postgres://localhost/yen" });
    boss.emit(
      "error",
      new Error(
        "Private Person +919876543210 private@example.com private@yenbank Bearer secret-token",
      ),
    );
    expect(write.mock.calls).toEqual([["pg-boss background operation failed\n"]]);
  } finally {
    write.mockRestore();
  }
});
