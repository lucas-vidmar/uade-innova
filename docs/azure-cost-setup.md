# Azure Cost Management — Configuración para Costos Reales

El dashboard del director (`#/director/dashboard`) puede mostrar costos reales de Azure en vez del cálculo estimado por tokens consumidos.

## 1. Crear Service Principal y asignar rol

Ejecutar con una cuenta que tenga permisos de **Owner** o **User Access Administrator** en la suscripción:

```bash
# 1. Crear Service Principal con rol Cost Management Reader en la suscripción
az ad sp create-for-rbac \
  --name sp-cost-mgmt-dashboard \
  --role "Cost Management Reader" \
  --scope /subscriptions/e581a4ea-1c70-477b-9258-98a51fac57cf

# Este comando devuelve:
# {
#   "appId": "<AZURE_CLIENT_ID>",
#   "displayName": "sp-cost-mgmt-dashboard",
#   "password": "<AZURE_CLIENT_SECRET>",
#   "tenant": "<AZURE_TENANT_ID>"
# }
```

## 2. Configurar variables de entorno en la Function App

```bash
az functionapp config appsettings set \
  --name func-dashboard-ingest-q47bia47kk3na \
  --resource-group RG_UADE_INNOVA_DEV \
  --settings \
    AZURE_CLIENT_ID="<appId-del-paso-anterior>" \
    AZURE_CLIENT_SECRET="<password-del-paso-anterior>" \
    AZURE_TENANT_ID="<tenant-del-paso-anterior>"
```

`AZURE_SUBSCRIPTION_ID` ya está configurada en `e581a4ea-1c70-477b-9258-98a51fac57cf`.

## 3. Verificar en el Dashboard

Acceder al dashboard del director (`#/director/dashboard`). La card de costos debe mostrar:
```
Fuente: Azure Cost Management API · Incluye N servicios
```

## 4. Variables de entorno adicionales (opcionales)

| Variable | Default | Descripción |
|---|---|---|
| `DIRECTOR_BUDGET_MONTHLY_USD` | `10000` | Presupuesto mensual en USD |
| `BUDGET_WEEKEND_FACTOR` | `0.6` | Factor de actividad en fines de semana (0-1) |
| `AI_INPUT_COST_PER_MILLION_TOKENS` | `0.15` | Costo por millón de tokens input (fallback token-based) |
| `AI_OUTPUT_COST_PER_MILLION_TOKENS` | `0.60` | Costo por millón de tokens output (fallback token-based) |
| `AI_PRICING_EFFECTIVE_FROM` | — | Fecha (`YYYY-MM-DD`) desde la que vale el precio configurado. El panel de costo la muestra junto al precio; si el precio se configura por entorno y esta fecha no se declara, el panel dice «sin fecha de vigencia declarada» en vez de inventar una (UJ-54 / #528). |
