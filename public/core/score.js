const DEDUCTIONS = Object.freeze({ P0: 30, P1: 10, P2: 4, P3: 1, INFO: 0 });

export function computeScore(findings = [], coverage = {}) {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0, INFO: 0 };
  let deduction = 0;
  for (const finding of findings) {
    if (!Object.hasOwn(counts, finding?.severity)) continue;
    counts[finding.severity] += 1;
    if (finding.scored !== false && finding.severity !== 'INFO') deduction += DEDUCTIONS[finding.severity];
  }
  const raw = Math.max(0, 100 - deduction);
  const scoreStatus = coverage?.status === 'failed'
    ? 'unavailable'
    : coverage?.status === 'partial' ? 'sample_only' : 'valid';
  let score = scoreStatus === 'unavailable' ? null : raw;
  if (score !== null && counts.P0) score = Math.min(score, 40);
  else if (score !== null && counts.P1) score = Math.min(score, 79);
  const capped = score !== null && score < raw;
  let grade;
  if (counts.P0) grade = 'red';
  else if (scoreStatus === 'unavailable') grade = 'gray';
  else if (score < 60) grade = 'red';
  else if (counts.P1 || score < 85 || coverage?.defects) grade = 'yellow';
  else grade = 'green';
  return { score, raw, grade, capped, scoreStatus, counts };
}
