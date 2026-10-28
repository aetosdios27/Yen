import { migrate, type Sql, uuidv7 } from "@yen/db";
import { type UserId, userIdSchema } from "@yen/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { databaseSuite } from "../../db/src/test/database.js";
import { generateYenId } from "./format.js";
import {
  lookupYenId,
  maskDisplayName,
  RateLimitExceededError,
  type RateLimiter,
} from "./lookup.js";
import { assignYenId } from "./storage.js";

async function createTestUser(
  sql: Sql,
  displayName: string,
  phone = `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`,
): Promise<UserId> {
  const id = uuidv7();
  await sql`
    INSERT INTO users (id, phone, display_name)
    VALUES (${id}, ${phone}, ${displayName})
  `;
  return userIdSchema.parse(id);
}

describe("Display name masking unit tests", () => {
  it("masks all letters in words after the initial character", () => {
    expect(maskDisplayName("Rahul Patel")).toBe("R**** P****");
    expect(maskDisplayName("Aetos Dios")).toBe("A**** D***");
    expect(maskDisplayName("Priya")).toBe("P****");
    expect(maskDisplayName("A B C")).toBe("A B C");
    expect(maskDisplayName("")).toBe("");
  });

  it("masks Devanagari names by grapheme without corrupting multi-byte characters", () => {
    // "राहुल पटेल" -> initial "र" + 4 stars, "प" + 3 stars
    const masked = maskDisplayName("राहुल पटेल");
    expect(masked).toBe("र**** प***");
  });
});

databaseSuite("Yen ID lookup service", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  it("refuses a bad check digit before executing ANY database query", async () => {
    let queryCount = 0;
    // Counting SQL proxy wrapper
    const countingSql = new Proxy(sql, {
      apply(target, thisArg, argArray) {
        queryCount++;
        return Reflect.apply(target, thisArg, argArray);
      },
      get(target, prop, receiver) {
        const orig = Reflect.get(target, prop, receiver);
        if (typeof orig === "function") {
          return (...args: unknown[]) => {
            queryCount++;
            return orig.apply(target, args);
          };
        }
        return orig;
      },
    });

    const limiter: RateLimiter = {
      consume: async () => ({ allowed: true }),
    };

    // Construct an ID with an invalid check digit
    const valid = generateYenId();
    const wrongCheckDigit = (Number(valid[8]) + 1) % 10;
    const invalidId = `${valid.slice(0, 8)}${wrongCheckDigit}`;

    await expect(
      lookupYenId(countingSql, {
        yenId: invalidId,
        limiter,
        viewerKey: "test-viewer-ip",
      }),
    ).rejects.toThrow(/Invalid check digit/);

    // Strict assertion: zero SQL queries were dispatched to the database
    expect(queryCount).toBe(0);
  });

  it("enforces rate limiting and ensures found and not-found IDs appear identical when limited", async () => {
    const user = await createTestUser(sql, "Secret Person");
    const existingId = await assignYenId(sql, user);
    const nonExistentId = generateYenId();

    const blockedLimiter: RateLimiter = {
      consume: async () => ({ allowed: false }),
    };

    // Query for existing ID while rate limited
    await expect(
      lookupYenId(sql, {
        yenId: existingId,
        limiter: blockedLimiter,
        viewerKey: "blocked-ip",
      }),
    ).rejects.toThrow(RateLimitExceededError);

    // Query for non-existent ID while rate limited
    await expect(
      lookupYenId(sql, {
        yenId: nonExistentId,
        limiter: blockedLimiter,
        viewerKey: "blocked-ip",
      }),
    ).rejects.toThrow(RateLimitExceededError);
  });

  it("returns ONLY the masked display name for an existing active user", async () => {
    const sensitivePhone = "+919876543210";
    const user = await createTestUser(sql, "Kavita Ramachandran", sensitivePhone);
    const assignedId = await assignYenId(sql, user);

    const allowedLimiter: RateLimiter = {
      consume: async () => ({ allowed: true }),
    };

    const result = await lookupYenId(sql, {
      yenId: assignedId,
      limiter: allowedLimiter,
      viewerKey: "inviting-owner-key",
    });

    expect(result).toBe("K***** R***********");

    // Negative assertions: phone number, user ID, and internal details must NEVER leak
    expect(result).not.toContain(sensitivePhone);
    expect(result).not.toContain(user);
    expect(result).not.toContain("pseudonym");
  });

  it("returns null when a valid Yen ID does not exist or has been tombstoned", async () => {
    const nonExistentId = generateYenId();
    const allowedLimiter: RateLimiter = {
      consume: async () => ({ allowed: true }),
    };

    const notFoundResult = await lookupYenId(sql, {
      yenId: nonExistentId,
      limiter: allowedLimiter,
      viewerKey: "viewer-key",
    });
    expect(notFoundResult).toBeNull();

    // Tombstoned user lookup also returns null
    const tempUser = await createTestUser(sql, "Erased Person");
    const tempId = await assignYenId(sql, tempUser);
    await sql`DELETE FROM users WHERE id = ${tempUser}`;

    const tombstoneResult = await lookupYenId(sql, {
      yenId: tempId,
      limiter: allowedLimiter,
      viewerKey: "viewer-key",
    });
    expect(tombstoneResult).toBeNull();
  });
});
