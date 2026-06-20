import { StorageManagementClient } from '@azure/arm-storage';
import { DefaultAzureCredential } from '@azure/identity';

const EXPECTED_CONTRACT = {
  rules: [
    {
      name: 'ArchiveOldSemesterMaterials',
      enabled: true,
      type: 'Lifecycle',
      actions: {
        baseBlob: {
          tierToArchive: {
            daysAfterModificationGreaterThan: 180,
          },
        },
      },
      filters: {
        blobTypes: ['blockBlob'],
        prefixMatch: ['class-materials/semester-', 'processed/semester-'],
      },
    },
    {
      name: 'DeleteArchiveAfter2Years',
      enabled: true,
      type: 'Lifecycle',
      actions: {
        baseBlob: {
          delete: {
            daysAfterModificationGreaterThan: 730,
          },
        },
      },
      filters: {
        blobTypes: ['blockBlob'],
        prefixMatch: ['class-materials/', 'processed/'],
      },
    },
  ],
};

function getStorageClient() {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP_NAME;
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;

  if (!subscriptionId || !resourceGroup || !accountName) {
    throw new Error(
      'Missing environment variables: AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP_NAME, AZURE_STORAGE_ACCOUNT_NAME'
    );
  }

  return { subscriptionId, resourceGroup, accountName };
}

function findRule(rules, name) {
  return (rules || []).find((r) => r.name === name);
}

function arraysMatchUnordered(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

function checkRulePresence(deployedRules, contractRule) {
  const deployed = findRule(deployedRules, contractRule.name);
  if (!deployed) {
    return {
      rule: contractRule.name,
      compliant: false,
      field: 'exists',
      expected: true,
      actual: false,
      detail: `Rule "${contractRule.name}" not found in deployed policy`,
    };
  }
  return null;
}

function checkRuleProperty(deployedRules, contractRule, path, label) {
  const deployed = findRule(deployedRules, contractRule.name);
  if (!deployed) return null;

  const actual = path.reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : undefined), deployed);
  const expected = path.reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : undefined), contractRule);

  const matches = Array.isArray(expected) && Array.isArray(actual)
    ? arraysMatchUnordered(actual, expected)
    : JSON.stringify(actual) === JSON.stringify(expected);

  if (!matches) {
    return {
      rule: contractRule.name,
      compliant: false,
      field: label,
      expected,
      actual,
    };
  }
  return null;
}

export async function checkStorageLifecycleCompliance() {
  const { subscriptionId, resourceGroup, accountName } = getStorageClient();

  const client = new StorageManagementClient(new DefaultAzureCredential(), subscriptionId);

  let deployedPolicy;
  try {
    deployedPolicy = await client.managementPolicies.get(
      resourceGroup,
      accountName,
      'default'
    );
  } catch (err) {
    return {
      compliant: false,
      error: `Failed to fetch management policy: ${err.message}`,
      timestamp: new Date().toISOString(),
    };
  }

  const deployedRules = deployedPolicy?.properties?.policy?.rules || [];

  const mismatches = [];

  const expectedNames = new Set(EXPECTED_CONTRACT.rules.map((r) => r.name));
  for (const deployed of deployedRules) {
    if (!expectedNames.has(deployed.name)) {
      mismatches.push({
        rule: deployed.name,
        compliant: false,
        field: 'unexpected_rule',
        expected: 'not present',
        actual: deployed.name,
        detail: `Unexpected rule "${deployed.name}" found in deployed policy`,
      });
    }
  }

  for (const contractRule of EXPECTED_CONTRACT.rules) {
    const presence = checkRulePresence(deployedRules, contractRule);
    if (presence) {
      mismatches.push(presence);
      continue;
    }

    const enabledCheck = checkRuleProperty(deployedRules, contractRule, ['enabled'], `${contractRule.name}.enabled`);
    if (enabledCheck) mismatches.push(enabledCheck);

    const typeCheck = checkRuleProperty(deployedRules, contractRule, ['type'], `${contractRule.name}.type`);
    if (typeCheck) mismatches.push(typeCheck);

    if (contractRule.actions?.baseBlob?.tierToArchive) {
      const archiveDays = checkRuleProperty(
        deployedRules,
        contractRule,
        ['actions', 'baseBlob', 'tierToArchive', 'daysAfterModificationGreaterThan'],
        `${contractRule.name}.tierToArchive.days`
      );
      if (archiveDays) mismatches.push(archiveDays);
    }

    if (contractRule.actions?.baseBlob?.delete) {
      const deleteDays = checkRuleProperty(
        deployedRules,
        contractRule,
        ['actions', 'baseBlob', 'delete', 'daysAfterModificationGreaterThan'],
        `${contractRule.name}.delete.days`
      );
      if (deleteDays) mismatches.push(deleteDays);
    }

    const prefixMatch = checkRuleProperty(
      deployedRules,
      contractRule,
      ['filters', 'prefixMatch'],
      `${contractRule.name}.prefixMatch`
    );
    if (prefixMatch) mismatches.push(prefixMatch);

    const blobTypes = checkRuleProperty(
      deployedRules,
      contractRule,
      ['filters', 'blobTypes'],
      `${contractRule.name}.blobTypes`
    );
    if (blobTypes) mismatches.push(blobTypes);
  }

  return {
    compliant: mismatches.length === 0,
    mismatches,
    deployedRuleCount: deployedRules.length,
    expectedRuleCount: EXPECTED_CONTRACT.rules.length,
    timestamp: new Date().toISOString(),
  };
}
