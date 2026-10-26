import { readFileSync } from "node:fs";

const report = readFileSync(new URL("../lcov.info", import.meta.url), "utf8");
const records = report
  .split("end_of_record")
  .filter((record) => /^SF:(?:.*\/)?src\/RootRegistry\.sol\r?$/m.test(record));
if (records.length !== 1) throw new Error("Expected exactly one RootRegistry LCOV record");

function count(key) {
  const match = records[0].match(new RegExp(`^${key}:(\\d+)\\r?$`, "m"));
  if (!match) throw new Error(`RootRegistry coverage is missing ${key}`);
  return Number(match[1]);
}

const lines = count("LF");
const hitLines = count("LH");
const branches = count("BRF");
const hitBranches = count("BRH");
if (lines === 0 || branches === 0 || hitLines !== lines || hitBranches !== branches) {
  throw new Error(
    `RootRegistry requires 100% line AND branch coverage: lines ${hitLines}/${lines}, branches ${hitBranches}/${branches}`,
  );
}
console.log(
  `RootRegistry coverage: lines ${hitLines}/${lines}, branches ${hitBranches}/${branches}`,
);
