const DEFAULT_MIN_RATED = 10;
const DEFAULT_ALPHA = 0.05;

function normalCdf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

function twoProportionZTest(positive1, n1, positive2, n2) {
  if (n1 === 0 || n2 === 0) return { z: 0, pValue: 1 };

  const p1 = positive1 / n1;
  const p2 = positive2 / n2;
  const pHat = (positive1 + positive2) / (n1 + n2);

  if (pHat === 0 || pHat === 1) return { z: 0, pValue: 1 };

  const se = Math.sqrt(pHat * (1 - pHat) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, pValue: 1 };

  const z = (p1 - p2) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));

  return { z, pValue };
}

export function computeWinner(segments, minRatedThreshold = DEFAULT_MIN_RATED) {
  if (!segments || segments.length === 0) {
    return { state: 'insufficient_data', reason: 'no_data' };
  }

  if (segments.length === 1) {
    return segments[0].rated >= minRatedThreshold
      ? { state: 'insufficient_data', reason: 'single_segment' }
      : { state: 'insufficient_data', reason: 'insufficient_data_both' };
  }

  const contenders = segments
    .filter(s => s.rated >= minRatedThreshold && s.positive >= 0)
    .sort((a, b) => (b.satScore || 0) - (a.satScore || 0));

  if (contenders.length < 2) {
    return { state: 'insufficient_data', reason: 'insufficient_data_both' };
  }

  const best = contenders[0];
  const second = contenders[1];

  if (best.satScore === second.satScore) {
    return { state: 'tie' };
  }

  const { pValue } = twoProportionZTest(best.positive, best.rated, second.positive, second.rated);

  if (pValue < DEFAULT_ALPHA) {
    return {
      state: 'declared',
      winnerPromptVersion: best.promptVersion,
      pValue: Math.round(pValue * 10000) / 10000,
    };
  }

  return { state: 'insufficient_data', reason: 'insufficient_data_not_significant', pValue: Math.round(pValue * 10000) / 10000 };
}
