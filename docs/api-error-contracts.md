# API Error Contracts

Every endpoint returns structured errors containing `errorCategory` and `code` for consistent frontend handling and observability.

## Shared Error Taxonomy

| Category | Code Prefix | When |
|---|---|---|
| `VALIDATION` | `MISSING_FIELDS`, `INVALID_JSON`, `INVALID_FILE_TYPE` | Input validation failures |
| `AUTH` | `FRONTDOOR_INVALID`, `ENROLLMENT_INACTIVE`, `ENROLLMENT_CHECK_FAILED`, `AUTH_REQUIRED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `FORBIDDEN` | Auth/authorization failures |
| `STORAGE` | — | Blob/Table Storage failures |
| `PARSING` | `PDF_PARSE_ERROR`, `PPTX_PARSE_ERROR`, `UNSUPPORTED_FILE_TYPE` | File parsing failures |
| `RETRIEVAL_FAILURE` | — | Pinecone/vector search failures |
| `SAFETY` | `SAFETY_BLOCKED` | Content filter / policy violations |
| `LLM` | — | AI/chat completion failures (default) |
| `RATE_LIMIT` | — | Rate limiting |
| `NOT_FOUND` | — | Resource not found |
| `INTERNAL` | — | Unclassified server errors |

## OIDC Token Validation (`withAuth` middleware, #218)

Applied on Functions wrapped with `withAuth`. Resolution order: `Authorization: Bearer` (Entra OIDC + JWKS) → SWA `x-ms-client-principal` → mock (Development or `AUTH_MOCK_ENABLED=true`).

| Status | Category | Code | Scenario |
|---|---|---|---|
| 401 | `AUTH` | `AUTH_REQUIRED` | Role-required route with no authenticated identity |
| 401 | `AUTH` | `INVALID_TOKEN` | Bearer token present but malformed / bad signature / wrong issuer / wrong audience / wrong alg |
| 401 | `AUTH` | `TOKEN_EXPIRED` | Bearer token expired or `nbf` in the future |
| 403 | `AUTH` | `FORBIDDEN` | Authenticated but lacks the required role (e.g. Alumno on Docente-gated route) |

Behavior contract: a token that **is** present but invalid is **never** silently downgraded to the SWA/mock path — it always returns a structured 401/403 above. When no token is present, the SWA principal (or guarded mock) governs.

## Error Response Shape

```json
{
  "error": "Human-readable message",
  "errorCategory": "VALIDATION",
  "code": "MISSING_FIELDS"
}
```

## Endpoint Contracts

### POST /api/ingest-material

| Status | Category | Code | Scenario |
|---|---|---|---|
| 400 | `VALIDATION` | `MISSING_FIELDS` | Missing classIds, subjectId, or materialType |
| 400 | `VALIDATION` | `INVALID_FILE_TYPE` | File content doesn't match declared type |
| 403 | `AUTH` | `FRONTDOOR_INVALID` | Invalid Front Door ID |
| 403 | `AUTH` | `ENROLLMENT_INACTIVE` | User not an active teacher for the subject |
| 500 | `AUTH` | — | Enrollment verification failure |
| 500 | `STORAGE` | — | Blob/Table Storage operation failed |
| 500 | `INTERNAL` | — | Unhandled error |

### POST /api/global-search

| Status | Category | Code | Scenario |
|---|---|---|---|
| 400 | `VALIDATION` | `INVALID_JSON` | Request body is not valid JSON |
| 400 | `VALIDATION` | `MISSING_FIELDS` | Missing query or subjectId |
| 403 | `AUTH` | `FRONTDOOR_INVALID` | Invalid Front Door ID |
| 403 | `AUTH` | `ENROLLMENT_INACTIVE` | User not enrolled in the subject |
| 500 | `AUTH` | `ENROLLMENT_CHECK_FAILED` | Enrollment verification failure |
| 500 | `RETRIEVAL_FAILURE` | — | Embedding or vector search failure |

### POST /api/rag-query

| Status | Category | Scenario |
|---|---|---|
| 500 | `LLM` | Embedding or chat completion failure |
| 500 | `RETRIEVAL_FAILURE` | Pinecone retrieval failure |
| 500 | `SAFETY` | Content filter blocked the response |
