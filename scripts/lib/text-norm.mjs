// Normalize a set name for fuzzy matching: lowercase, fold accents, "&" -> "and", strip punctuation.
export function normSetName(name) {
  return name
    .toLowerCase()
    .replace(/[éèêë]/g, 'e').replace(/[óòô]/g, 'o').replace(/[áàâ]/g, 'a')
    .replace(/&/g, 'and')          // "Black & White" → "black and white"
    .replace(/[^a-z0-9 ]/g, ' ')  // strip punctuation → spaces
    .replace(/\s+/g, ' ')
    .trim()
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// Fuzzy-match a candidate set name against a list of { groupId, name } TCGPlayer groups.
// Returns { match: group|null, confidence: number|null, candidates: [{groupId, name, score}, ...] (top 3) }
// Only auto-accepts high-confidence matches; anything uncertain is left for manual review
// rather than risking a silently-wrong price feed.
export function matchSetName(candidateName, groups) {
  const target = normSetName(candidateName)
  const scored = groups.map((g) => {
    const norm = normSetName(g.name)
    // TCGPlayer group names are commonly prefixed with a set code, e.g. "OGN: Origins" —
    // strip that before comparing so a clean match doesn't get docked to a lower score.
    const stripped = normSetName(g.name.replace(/^[A-Za-z0-9]+:\s*/, ''))
    let score
    if (norm === target || stripped === target) {
      score = 1.0
    } else {
      const shorter = norm.length < target.length ? norm : target
      const longer = norm.length < target.length ? target : norm
      const lenRatio = longer.length > 0 ? shorter.length / longer.length : 0
      if (shorter.length > 0 && longer.includes(shorter) && lenRatio >= 0.6) {
        score = 0.85
      } else {
        const dist = levenshtein(norm, target)
        score = 1 - dist / Math.max(norm.length, target.length, 1)
      }
    }
    return { group: g, score }
  }).sort((a, b) => b.score - a.score)

  const [best, second] = scored
  const acceptable = !!best && best.score >= 0.90 && (!second || best.score - second.score >= 0.05)

  return {
    match: acceptable ? best.group : null,
    confidence: acceptable ? best.score : null,
    candidates: scored.slice(0, 3).map((s) => ({ groupId: s.group.groupId, name: s.group.name, score: Math.round(s.score * 100) / 100 })),
  }
}
