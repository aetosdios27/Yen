import { migrate } from "@yen/db";
import { expect, it } from "vitest";
import { databaseSuite } from "../../db/src/test/database.js";
import { wrapJobPayload } from "./envelope.js";
import { WorkerRuntime } from "./worker.js";

databaseSuite("dead letter envelope", (sql, url) => {
  it("dead-letter readers see the original payload", async () => {
    await migrate(sql);
    const worker = new WorkerRuntime({ connectionString: url, migrate: true });
    try {
      await worker.start();
      await worker.getBoss().createQueue("envelope");
      const payload = { id: "original" };
      const id = await worker.getBoss().send("envelope", wrapJobPayload(payload));
      await sql`UPDATE pgboss.job SET state = 'failed' WHERE id = ${id}`;
      expect((await worker.getDeadLetterJobs("envelope"))[0]?.data).toEqual(payload);
    } finally {
      await worker.stop();
    }
  });
});
