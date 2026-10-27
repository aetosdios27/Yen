import type { Sql } from "@yen/db";

export async function databaseReady(sql: Sql): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sql`SELECT 1 FROM waitlist_entries LIMIT 0`.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
