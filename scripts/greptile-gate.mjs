const START_MARKER = "<!-- greptile_comment -->";

/**
 * @param {{ body: string | null | undefined, headSha: string }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluate({ body, headSha }) {
  if (typeof body !== "string") {
    return { ok: false, reason: "pull request body is missing" };
  }

  const starts = [...body.matchAll(/<!-- greptile_comment -->/g)];
  const ends = [...body.matchAll(/<!-- \/greptile_comment -->/g)];
  if (starts.length === 0 && ends.length === 0) {
    return {
      ok: false,
      reason: `waiting for a Greptile review of ${headSha}`,
    };
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { ok: false, reason: "Greptile review block is missing or malformed" };
  }

  const block = body.slice(starts[0].index + START_MARKER.length, ends[0].index);
  const markerMatches = [...block.matchAll(/<!-- greptile_confidence_score:([^>]*) -->/g)];
  if (markerMatches.length !== 1) {
    return { ok: false, reason: "Greptile confidence score marker is missing or malformed" };
  }

  const markerValue = markerMatches[0][1].trim();
  if (!/^[0-5]$/.test(markerValue)) {
    return { ok: false, reason: "Greptile confidence score must be a number from 0 to 5" };
  }
  const score = Number(markerValue);
  const headings = [...block.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const scoreHeadings = headings.flatMap((heading) => {
    const labels = [...heading[1].matchAll(/Confidence Score:/g)];
    if (labels.length === 0) {
      return [];
    }
    if (labels.length !== 1) {
      return [""];
    }
    return [heading[1].match(/Confidence Score:\s*([^\s<]+)\/5/)?.[1] ?? ""];
  });
  if (scoreHeadings.length !== 1 || !/^[0-5]$/.test(scoreHeadings[0])) {
    return { ok: false, reason: "Greptile confidence score heading is missing or malformed" };
  }
  const headingScore = Number(scoreHeadings[0]);
  if (headingScore !== score) {
    return { ok: false, reason: "Greptile confidence score heading does not match its marker" };
  }
  if (score !== 5) {
    return { ok: false, reason: `Greptile confidence score is ${score}/5; 5/5 is required` };
  }

  const reviewedCommits = [
    ...block.matchAll(
      /Last reviewed commit:\s*\[[^\]]*\]\(https:\/\/github\.com\/[^/\s)]+\/[^/\s)]+\/commit\/([0-9a-f]{40})\)/gi,
    ),
  ];
  if (reviewedCommits.length !== 1) {
    return { ok: false, reason: "Greptile reviewed commit is missing or malformed" };
  }
  const reviewedSha = reviewedCommits[0][1];
  if (!/^[0-9a-f]{40}$/i.test(headSha) || reviewedSha.toLowerCase() !== headSha.toLowerCase()) {
    return {
      ok: false,
      reason: `Greptile review is stale: reviewed ${reviewedSha}, current head is ${headSha}`,
    };
  }

  return { ok: true, reason: "Greptile reviewed the current commit with confidence 5/5" };
}
