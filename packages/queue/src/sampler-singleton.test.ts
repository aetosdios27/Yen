import { migrate } from "@yen/db";
import { expect, it } from "vitest";
import { databaseSuite } from "../../db/src/test/database.js";
import { WorkerRuntime } from "./worker.js";

databaseSuite("database-wide sampler scheduling", (sql, url) => {
  it("two runtimes share one serial sampler schedule", async () => {
    await migrate(sql);
    const first = new WorkerRuntime({ connectionString: url, migrate: true });
    const second = new WorkerRuntime({ connectionString: url });
    try {
      await first.start();
      await second.start();
      const schedule =
        await sql`SELECT name, cron FROM pgboss.schedule WHERE name = 'yen-money-telemetry'`;
      expect(Array.from(schedule)).toEqual([{ name: "yen-money-telemetry", cron: "* * * * *" }]);
      const queue = await sql`SELECT policy FROM pgboss.queue WHERE name = 'yen-money-telemetry'`;
      expect(queue[0]?.policy).toBe("singleton");
    } finally {
      await second.stop();
      await first.stop();
    }
  });
});
