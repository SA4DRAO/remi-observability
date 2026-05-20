# Validation Test Examples

## GitHub Issue #6 Implementation - Zod Schema Validation

### Valid Request Example
```json
POST /api/v1/events/batch
Content-Type: application/json

{
  "events": [
    {
      "event_type": "page_load",
      "data": { "url": "https://example.com" },
      "_seq": 1,
      "session_id": "123e4567-e89b-12d3-a456-426614174000"
    }
  ],
  "session_id": "123e4567-e89b-12d3-a456-426614174000"
}
```
**Response:** `202 Accepted` - Events queued successfully

---

### Invalid Request: Empty Events Array
```json
POST /api/v1/events/batch
{
  "events": []
}
```
**Response:** `400 Bad Request`
```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": "events",
      "message": "Array must contain at least 1 element(s)"
    }
  ]
}
```

---

### Invalid Request: Missing event_type
```json
POST /api/v1/events/batch
{
  "events": [
    {
      "data": { "key": "value" }
    }
  ]
}
```
**Response:** `400 Bad Request`
```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": "events.0.event_type",
      "message": "Required"
    }
  ]
}
```

---

### Invalid Request: Exceeds Max Batch Size
```json
POST /api/v1/events/batch
{
  "events": [ /* 1001 events */ ]
}
```
**Response:** `400 Bad Request`
```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": "events",
      "message": "Array must contain at most 1000 element(s)"
    }
  ]
}
```

---

### Invalid Request: session_id Too Long
```json
POST /api/v1/events/batch
{
  "events": [
    {
      "event_type": "click",
      "session_id": "a".repeat(256)
    }
  ]
}
```
**Response:** `400 Bad Request`
```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": "events.0.session_id",
      "message": "String must contain at most 255 character(s)"
    }
  ]
}
```

---

### Invalid Request: event_type Too Long
```json
POST /api/v1/events/batch
{
  "events": [
    {
      "event_type": "a".repeat(101)
    }
  ]
}
```
**Response:** `400 Bad Request`
```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": "events.0.event_type",
      "message": "String must contain at most 100 character(s)"
    }
  ]
}
```

---

## Implementation Summary

### Files Created
1. `src/types/validation.ts` - Zod schemas for Event and EventBatch
2. `src/middleware/validation.ts` - Generic validation middleware

### Files Modified
1. `src/middleware/index.ts` - Added validateBody export
2. `src/routes/events.routes.ts` - Applied validation to POST /batch

### Dependencies Added
- `zod@^4.3.6`

### Validation Constraints Enforced
✅ `event_type`: Required, 1-100 characters  
✅ `data`: Optional, must be object with string keys  
✅ `_seq`: Optional, non-negative integer  
✅ `run_id`: Optional, must be valid UUID  
✅ `session_id`: Optional, 1-255 characters  
✅ `timestamp`: Optional, must be ISO 8601 datetime  
✅ Batch size: 1-1000 events per request  

### Backward Compatibility
All previously valid requests continue to work. The schema enforces structure without breaking existing integrations.
