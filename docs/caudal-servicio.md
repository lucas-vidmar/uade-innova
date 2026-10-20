# Caudal del servicio — topes, reserva, aviso y registro (#458 / UJ-61)

Cómo se comporta el sistema cuando "todos consultan a la vez" en la víspera de
la evaluación, y cómo leer qué se degradó sin haber estado.

## Los dos ejes

Un tope por identidad no acota el caudal del servicio: N personas × su tope =
N × tope. Por eso hay dos ejes que se aplican juntos, en este orden:

| Eje | Clave del contador | Config | Default |
|---|---|---|---|
| Identidad | `uid:<persona>` (o `ip:<cliente>` sin identidad) | `rateLimit.tiers` | chat 30 · ingest 10 · general 60 · essential 120 por minuto |
| Servicio | `service` + clase (`interactive` / `essential`) | `rateLimit.service` | 600 por minuto en total |

La identidad se evalúa primero: quien ya se pasó de su tope no consume caudal
del servicio. Sólo cuentan contra el servicio los pedidos admitidos.

El estado vive en Table Storage (`RateLimitCounters`): el mismo volumen se topa
igual en cualquier instancia de la Function App. Si storage no responde, el
conteo cae a la memoria de la instancia (disponibilidad primero, tope
best-effort) y la API sigue respondiendo 429 anunciado.

## La reserva de lo esencial

Del total de servicio, un porcentaje se aparta para lo esencial y el caudal
interactivo **no puede** tocarlo:

```
RATE_LIMIT_SERVICE_PER_MIN=600   # techo total por ventana
RATE_LIMIT_RESERVE_PCT=25        # 150 reservados
→ interactivo: 450   ·   esencial: 150
```

Qué es esencial (`backend/src/services/caudal-policy.js`):

- `GET  /api/material-download` — entrega del documento
- `GET  /api/material-status[/{id}]` y `POST /api/material-status/batch` — consulta del material
- `GET  /api/materials/{id}` — metadatos del material
- `GET  /api/classes[/{subjectId}]` — la pantalla desde donde se llega al material

El asistente (`/api/rag-query`) queda del lado interactivo a propósito: es el
que produce el pico y el que consume cuota de modelo. Lo acota su tope por
persona, no la reserva.

## El aviso

Al cruzar `RATE_LIMIT_ALERT_THRESHOLD_PCT` (default 80%) del techo de la clase:

- La respuesta **lo anuncia** (no se degrada en silencio): `Warning: 299 - "caudal de servicio al 81% del tope (interactive)"`, más `X-Caudal-Class`, `X-Caudal-Service-Used`, `X-Caudal-Service-Limit`, `X-Caudal-Service-Total`, `X-Caudal-Reserve-Limit` y `X-Caudal-Threshold: umbral`.
- Se anota **una sola vez por ventana y clase** en el registro y se emite un evento `CaudalEvent` (`kind=threshold`) a Application Insights.
- `infra/modules/caudal-alert.bicep` manda el mail al operador (`notificationEmail`) cuando aparece ese evento y cuando las denegaciones pasan de 50 en cinco minutos.

Cada 429 dice qué eje cortó:

```json
{
  "error": "Demasiadas solicitudes. Intentá de nuevo en unos segundos.",
  "errorCategory": "RATE_LIMIT",
  "code": "RATE_LIMIT_EXCEEDED",
  "caudal": { "reason": "SERVICE_CAP", "class": "interactive", "tier": "chat",
              "used": 450, "limit": 450, "serviceTotal": 600, "reserve": 150,
              "retryAfterSec": 37 }
}
```

`reason` ∈ `IDENTITY_CAP` (esta persona se pasó) · `SERVICE_CAP` (el servicio se quedó sin caudal interactivo) · `RESERVE_EXHAUSTED` (la reserva de lo esencial también se agotó).

## El registro: reconstruir la noche

Cada denegación y cada cruce de umbral deja una fila en `RateLimitEvents`
(partición por día UTC):

| Campo | Para qué |
|---|---|
| `at`, `windowIdx`, `windowMs` | cuándo, en qué ventana |
| `key`, `caudalClass`, `tier`, `route`, `method` | quién y por qué endpoint |
| `reason` | qué eje cortó |
| `used`, `limit` | con qué caudal, a qué distancia del techo |
| `correlationId`, `instance` | para cruzar con el log y ver si fue una sola instancia |

La lectura es de sólo lectura y para quien opera:

```
GET /api/dashboard-admin/caudal?date=2026-10-16&limit=200
Authorization: Bearer <sesión de Director|Admin|Security>
```

Devuelve el estado de la ventana actual (`ok` / `umbral` / `tope` /
`reserva-agotada`), el caudal de cada clase, los topes declarados, las rutas
esenciales y el registro del día con sus totales por motivo.

## Verificar sin generarle carga al piloto

1. **Pruebas unitarias** (no tocan la red):
   `cd backend && npm test` — `with-rate-limit.caudal.test.js` simula 40
   identidades en la misma ventana, la reserva, el umbral y el registro sobre un
   almacén en memoria; `caudal-api.test.js` cubre la superficie de operación;
   `caudal-wiring.test.js` fija qué endpoint usa qué tier.
2. **Una consulta de lectura** al endpoint de arriba: dice el caudal de la
   ventana en curso y lo que quedó registrado, sin emitir tráfico de modelo.
3. **Una sola petición** que exceda el tope por identidad (`RATE_LIMIT_CHAT_PER_MIN`)
   alcanza para ver el 429 anunciado con sus cabeceras; no hace falta una ráfaga.
   Nunca subir los topes ni bajar los límites configurados en el piloto para
   "probar": lo que se mide es el límite real.
