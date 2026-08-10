import { CONFIG } from './config.js';

const MAX_BUCKETS = 10000;

export function createRateLimiter(options = {}) {
    const windowMs = Number(options.windowMs ?? CONFIG.rateLimit.windowMs) || 60000;
    const tiers = options.tiers ?? CONFIG.rateLimit.tiers;
    const nowFn = options.now ?? Date.now;
    const maxBuckets = Number(options.maxBuckets) || MAX_BUCKETS;

    const buckets = new Map();

    function resolveLimit(tier) {
        const limit = Number(tiers?.[tier]);
        if (Number.isFinite(limit) && limit > 0) return limit;
        const general = Number(tiers?.general);
        return Number.isFinite(general) && general > 0 ? general : 60;
    }

    function bucketKey(key, tier) {
        return `${tier}:${key}`;
    }

    function pruneExpired(mapKey) {
        const timestamps = buckets.get(mapKey);
        if (!timestamps) return null;
        const cutoff = nowFn() - windowMs;
        let i = 0;
        while (i < timestamps.length && timestamps[i] <= cutoff) i++;
        if (i > 0) timestamps.splice(0, i);
        if (timestamps.length === 0) {
            buckets.delete(mapKey);
            return null;
        }
        return timestamps;
    }

    function sweepExpired() {
        if (buckets.size < maxBuckets) return;
        const cutoff = nowFn() - windowMs;
        for (const [mapKey, timestamps] of buckets) {
            let i = 0;
            while (i < timestamps.length && timestamps[i] <= cutoff) i++;
            if (i > 0) timestamps.splice(0, i);
            if (timestamps.length === 0) buckets.delete(mapKey);
        }
    }

    function check(key, tier = 'general') {
        const limit = resolveLimit(tier);
        const mapKey = bucketKey(key, tier);
        sweepExpired();
        const timestamps = pruneExpired(mapKey);
        if (timestamps && timestamps.length >= limit) {
            const oldest = timestamps[0];
            const retryAfterSec = Math.max(1, Math.ceil((windowMs - (nowFn() - oldest)) / 1000));
            return { allowed: false, retryAfterSec };
        }
        if (!buckets.has(mapKey)) buckets.set(mapKey, []);
        buckets.get(mapKey).push(nowFn());
        return { allowed: true };
    }

    return { check };
}
