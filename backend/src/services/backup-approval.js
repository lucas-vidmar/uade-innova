import { v4 as uuidv4 } from 'uuid';
import { loadJson, saveJson, deleteBlob, listBlobs } from './storage.js';

const APPROVALS_CONTAINER = 'backup-approvals';
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

function isExpired(approval) {
    if (!approval?.expiresAt) return true;
    return new Date(approval.expiresAt).getTime() <= Date.now();
}

export async function saveApproval({ subjectId, approvedBy }) {
    if (!subjectId) throw new Error('subjectId is required');
    if (!approvedBy) throw new Error('approvedBy is required');

    const now = new Date();
    const approval = {
        id: uuidv4(),
        subjectId,
        approved: true,
        approvedBy,
        approvedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    };

    await saveJson(APPROVALS_CONTAINER, `${subjectId}.json`, approval);
    return approval;
}

export async function getApproval({ subjectId }) {
    if (!subjectId) return null;
    try {
        const approval = await loadJson(APPROVALS_CONTAINER, `${subjectId}.json`);
        if (!approval || isExpired(approval)) {
            return null;
        }
        return approval;
    } catch {
        return null;
    }
}

export async function revokeApproval({ subjectId }) {
    if (!subjectId) throw new Error('subjectId is required');
    await deleteBlob(APPROVALS_CONTAINER, `${subjectId}.json`);
}

export async function listActiveApprovals() {
    try {
        const blobNames = await listBlobs(APPROVALS_CONTAINER);
        const active = [];
        for (const name of blobNames) {
            if (!name.endsWith('.json')) continue;
            try {
                const approval = await loadJson(APPROVALS_CONTAINER, name);
                if (approval && !isExpired(approval)) {
                    active.push(approval);
                }
            } catch {
                continue;
            }
        }
        return active;
    } catch {
        return [];
    }
}
