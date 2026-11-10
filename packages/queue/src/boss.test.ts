import { expect, it, vi } from "vitest";
import { createPgBoss } from "./boss.js";

it("keeps personal data in pg-boss errors out of the log stream", () => {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    const boss = createPgBoss({ connectionString: "postgres://localhost/yen" });
    boss.emit(
      "error",
      Object.assign(new Error("private@example.com +919876543210"), { code: "ECONNREFUSED" }),
    );
    expect(write.mock.calls).toEqual([
      ["pg-boss background operation failed name=Error code=ECONNREFUSED\n"],
    ]);
  } finally {
    write.mockRestore();
  }
});
