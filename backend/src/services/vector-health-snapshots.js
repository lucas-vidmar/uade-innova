import { saveJson, listBlobs, deleteBlob, loadJson } from './storage.js';
import { getIndexStats } from './vector-store.js';

const SNAPSHOT_CONTAINER = 'vector-snapshots';

function pad(n) {
    return String(n).padStart(2, '0');
}

function formatDatePath(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTimestampSuffix(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds())}Z.json`;
}

function validateStats(stats) {
    if (!stats || typeof stats !== 'object') throw new Error('[VectorHealthSnapshots] Invalid stats response from Pinecone');
    const vc = stats.totalVectorCount;
    const inf = stats.indexFullness;
    if (typeof vc !== 'number' || !Number.isFinite(vc) || vc < 0) throw new Error(`[VectorHealthSnapshots] Invalid totalVectorCount: ${vc}`);
    if (typeof inf !== 'number' || !Number.isFinite(inf) || inf < 0 || inf > 1) throw new Error(`[VectorHealthSnapshots] Invalid indexFullness: ${inf}`);
}

export async function captureSnapshot() {
    const stats = await getIndexStats();
    validateStats(stats);

    const now = new Date();
    const payload = {
        provider: 'pinecone',
        indexName: process.env.PINECONE_INDEX_NAME || 'dashboard-edu-pilot',
        totalVectorCount: stats.totalVectorCount,
        indexFullness: stats.indexFullness,
        namespaces: stats.namespaces || {},
        timestamp: now.toISOString(),
    };

    const blobName = `${formatDatePath(now)}/${formatTimestampSuffix(now)}`;
    await saveJson(SNAPSHOT_CONTAINER, blobName, payload);
    return payload;
}

export async function listSnapshots({ days } = {}) {
    const d = Number.isFinite(days) && days > 0 ? days : 7;
    const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);

    const allBlobs = await listBlobs(SNAPSHOT_CONTAINER);

    return allBlobs
        .filter(name => {
            if (!name.endsWith('.json')) return false;
            const datePart = name.split('/')[0];
            if (!datePart) return false;
            const blobDate = new Date(datePart);
            return !Number.isNaN(blobDate.getTime()) && blobDate >= cutoff;
        })
        .sort()
        .reverse();
}

export async function listSnapshotsWithContent({ days } = {}) {
    const names = await listSnapshots({ days });
    const results = [];
    for (const name of names) {
        const data = await loadJson(SNAPSHOT_CONTAINER, name);
        if (data) results.push(data);
    }
    return results;
}

export async function deleteOlderThan(retentionDays) {
    const retention = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 90;
    const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000);
    const allBlobs = await listBlobs(SNAPSHOT_CONTAINER);
    let deleted = 0;

    for (const name of allBlobs) {
        const datePart = name.split('/')[0];
        if (!datePart) continue;
        const blobDate = new Date(datePart);
        if (Number.isNaN(blobDate.getTime())) continue;
        if (blobDate < cutoff) {
            try {
                await deleteBlob(SNAPSHOT_CONTAINER, name);
                deleted++;
            } catch (err) {
                console.warn(`[VectorHealthSnapshots] Failed to delete ${name}:`, err.message);
            }
        }
    }

    return deleted;
}
