import { DefaultAzureCredential } from '@azure/identity';

const COST_API_VERSION = '2023-09-01';
const MANAGEMENT_SCOPE = 'https://management.azure.com/.default';

function getSubscriptionId() {
    return process.env.AZURE_SUBSCRIPTION_ID || '';
}

function getWeekendActivityFactor() {
    const raw = process.env.BUDGET_WEEKEND_FACTOR;
    const val = raw ? Number(raw) : 0.6;
    return Number.isFinite(val) && val >= 0 && val <= 1 ? val : 0.6;
}

function canAuthenticate() {
    return !!(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID);
}

export async function queryAzureCost(context) {
    const subscriptionId = getSubscriptionId();
    if (!subscriptionId) {
        context.log.warn('[AzureCost] AZURE_SUBSCRIPTION_ID not set — skipping');
        return null;
    }

    if (!canAuthenticate()) {
        context.log('[AzureCost] No Azure service principal credentials found — using token-based fallback. Para activar costos reales: crear SP con "az ad sp create-for-rbac --name sp-cost-mgmt-dashboard --role \"Cost Management Reader\" --scope /subscriptions/' + subscriptionId + '" y setear AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID en App Settings');
        return null;
    }

    try {
        const credential = new DefaultAzureCredential();
        const token = await withTimeout(
            credential.getToken(MANAGEMENT_SCOPE),
            5000,
            'Azure credential acquisition timed out',
        );

        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const monthStart = `${year}-${month}-01`;
        const todayStr = now.toISOString().slice(0, 10);

        const queryBody = {
            type: 'ActualCost',
            timeframe: 'Custom',
            timePeriod: { from: monthStart, to: todayStr },
            dataset: {
                granularity: 'Daily',
                aggregation: {
                    totalCost: { name: 'PreTaxCost', function: 'Sum' },
                },
                grouping: [
                    { type: 'Dimension', name: 'ServiceName' },
                ],
            },
        };

        const response = await fetch(
            `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=${COST_API_VERSION}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(queryBody),
            },
        );

        if (!response.ok) {
            const errorText = await response.text();
            context.log.warn(`[AzureCost] API error ${response.status}: ${errorText.slice(0, 500)}`);
            return null;
        }

        const data = await response.json();
        return transformCostResponse(data, year, month);
    } catch (err) {
        context.log.warn(`[AzureCost] Query failed: ${err.message}`);
        return null;
    }
}

function transformCostResponse(data, year, month) {
    const rows = data?.properties?.rows || [];
    if (rows.length === 0) {
        return { totalCost: 0, byService: [], daily: [], source: 'azure-cost-api', note: 'No cost data returned' };
    }

    const byService = {};
    const dailyMap = {};
    let totalCost = 0;

    for (const row of rows) {
        const cost = Number(row[0]) || 0;
        const dateStr = String(row[1] || '').slice(0, 10);
        const serviceName = String(row[2] || 'Unknown').trim();

        totalCost += cost;

        if (!byService[serviceName]) {
            byService[serviceName] = { serviceName, cost: 0 };
        }
        byService[serviceName].cost += cost;

        if (dateStr) {
            if (!dailyMap[dateStr]) {
                dailyMap[dateStr] = { date: dateStr, cost: 0 };
            }
            dailyMap[dateStr].cost += cost;
        }
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return {
        totalCost: Number(totalCost.toFixed(6)),
        byService: Object.values(byService).sort((a, b) => b.cost - a.cost),
        daily,
        source: 'azure-cost-api',
        monthStart: `${year}-${String(month).padStart(2, '0')}-01`,
        updatedAt: new Date().toISOString(),
    };
}

export async function getAzureCostForBudget(context) {
    const costData = await queryAzureCost(context);
    if (!costData) {
        return {
            success: false,
            currentMonthSpend: 0,
            byService: [],
            daily: [],
            source: 'token-based-fallback',
        };
    }

    const currentMonthSpend = costData.byService.reduce((sum, s) => sum + s.cost, 0);

    return {
        success: true,
        currentMonthSpend: Number(currentMonthSpend.toFixed(6)),
        totalCost: costData.totalCost,
        byService: costData.byService,
        daily: costData.daily,
        source: 'azure-cost-api',
    };
}

export function computeBudgetProjection(daily, options = {}) {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const year = todayUtc.getUTCFullYear();
    const month = todayUtc.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const daysElapsed = todayUtc.getUTCDate();
    const daysRemaining = daysInMonth - daysElapsed;

    const monthStartIso = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;

    let currentMonthSpend = options.currentMonthSpend || 0;
    let costSource = options.costSource || 'token-based';

    if (!options.currentMonthSpend && daily.length > 0) {
        currentMonthSpend = 0;
        for (const d of daily) {
            if (d.date.startsWith(monthStartIso)) {
                currentMonthSpend += d.totalCost || d.cost || 0;
            }
        }
        currentMonthSpend = Number(currentMonthSpend.toFixed(6));
    }

    const monthDaily = daily.filter(d => d.date.startsWith(monthStartIso));
    const filledDays = monthDaily.length;

    let avgDailyCost = 0;
    let projectionMethod = 'simple-average';

    if (filledDays >= 7) {
        const recent7 = monthDaily.slice(-7);
        const weights = [1, 2, 3, 4, 5, 6, 7].slice(0, recent7.length);
        const totalWeight = weights.reduce((s, w) => s + w, 0);
        const weightedSum = recent7.reduce((sum, d, i) => {
            const cost = d.totalCost || d.cost || 0;
            return sum + cost * (weights[i] || 1);
        }, 0);
        avgDailyCost = weightedSum / totalWeight;
        projectionMethod = 'weighted-7d-trend';
    } else if (filledDays > 0) {
        const totalCost = monthDaily.reduce((sum, d) => sum + (d.totalCost || d.cost || 0), 0);
        avgDailyCost = totalCost / filledDays;
        projectionMethod = 'simple-average';
    }

    let weekdayRemaining = 0;
    let weekendRemaining = 0;
    for (let i = 1; i <= daysRemaining; i++) {
        const checkDate = new Date(Date.UTC(year, month, daysElapsed + i));
        const dayOfWeek = checkDate.getUTCDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            weekendRemaining++;
        } else {
            weekdayRemaining++;
        }
    }

    const weekendFactor = getWeekendActivityFactor();
    const projectedRemaining = (weekdayRemaining * avgDailyCost) + (weekendRemaining * avgDailyCost * weekendFactor);
    const projectedEndOfMonth = currentMonthSpend + projectedRemaining;

    const monthlyBudget = getMonthlyBudget();
    const percentUsed = monthlyBudget > 0 ? (projectedEndOfMonth / monthlyBudget) * 100 : 0;
    const remainingBudget = Math.max(0, monthlyBudget - currentMonthSpend);

    return {
        monthlyLimit: monthlyBudget,
        currentSpend: Number(currentMonthSpend.toFixed(6)),
        projectedEndOfMonth: Number(projectedEndOfMonth.toFixed(6)),
        remainingBudget: Number(remainingBudget.toFixed(6)),
        percentUsed: Number(percentUsed.toFixed(1)),
        warningLevel: percentUsed >= 95 ? 'critical' : percentUsed >= 80 ? 'warning' : 'none',
        projectionMethod,
        weekendFactor,
        costSource,
    };
}

function getMonthlyBudget() {
    const rawBudget = process.env.DIRECTOR_BUDGET_MONTHLY_USD;
    if (!rawBudget) return 10000;
    const parsedBudget = Number(rawBudget);
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) return 10000;
    return parsedBudget;
}

async function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message || `Timed out after ${ms}ms`)), ms);
    });
    try {
        const result = await Promise.race([promise, timeout]);
        return result;
    } finally {
        clearTimeout(timer);
    }
}
