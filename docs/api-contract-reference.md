# API Contract Reference

This document is a request and response contract guide for REST and WebSocket interfaces, with copy-paste Postman examples.

## Base URL

- Local: http://localhost:8000
- Health route: /
- API prefix: /api
- WebSocket endpoint: ws://localhost:8000/ws

## Conventions

- Content type for JSON requests: application/json
- All timestamps are ISO 8601 date-time strings.
- Validation failures return HTTP 400 with an error message and details list.
- Server failures return HTTP 500 (or 503 when security middleware errors).
- List endpoints return data arrays in a data field.

## Authentication and Security Notes

This codebase currently does not implement user authentication tokens. Arcjet middleware enforces security and rate limiting policies globally.

For client tooling:
- Include User-Agent header to avoid bot-detection errors in strict environments.

## Error Contract

Typical validation error:

~~~json
{
  "error": "Invalid payload",
  "details": [
    {
      "code": "too_small",
      "path": ["message"],
      "message": "Too small: expected string to have >=1 characters"
    }
  ]
}
~~~

Typical server error:

~~~json
{
  "error": "Failed to create commentary"
}
~~~

---

## 1. Health

### GET /

Purpose:
- Basic liveness check.

#### Postman Request

Method: GET
URL: http://localhost:8000/

#### Success Response

Status: 200

~~~text
Server is running
~~~

---

## 2. Matches API

## 2.1 GET /api/matches

Purpose:
- Fetch recent matches ordered by newest first.

Query params:
- limit optional integer, positive, max 100, default 50.

#### Postman Request

Method: GET
URL: http://localhost:8000/api/matches?limit=20

Headers:
- Accept: application/json
- User-Agent: PostmanRuntime/7.43.0

#### Success Response

Status: 200

~~~json
{
  "data": [
    {
      "id": 12,
      "sport": "football",
      "homeTeam": "Arsenal",
      "awayTeam": "Liverpool",
      "status": "live",
      "startTime": "2026-03-23T12:00:00.000Z",
      "endTime": "2026-03-23T13:45:00.000Z",
      "homeScore": 0,
      "awayScore": 0,
      "createdAt": "2026-03-23T11:55:00.000Z"
    }
  ]
}
~~~

#### Validation Failure Example

Status: 400

~~~json
{
  "error": "Invalid query parameters",
  "details": [
    {
      "code": "too_big",
      "path": ["limit"],
      "message": "Too big: expected number to be <=100"
    }
  ]
}
~~~

## 2.2 POST /api/matches

Purpose:
- Create a new match and broadcast a match_created event to all WebSocket clients.

Body contract:
- sport required non-empty string.
- homeTeam required non-empty string.
- awayTeam required non-empty string.
- startTime required ISO date-time string.
- endTime required ISO date-time string and must be greater than startTime.
- homeScore optional non-negative integer.
- awayScore optional non-negative integer.

#### Postman Request

Method: POST
URL: http://localhost:8000/api/matches

Headers:
- Content-Type: application/json
- Accept: application/json
- User-Agent: PostmanRuntime/7.43.0

Body:

~~~json
{
  "sport": "football",
  "homeTeam": "AC Milan",
  "awayTeam": "Inter Milan",
  "startTime": "2026-03-23T18:00:00.000Z",
  "endTime": "2026-03-23T19:45:00.000Z",
  "homeScore": 0,
  "awayScore": 0
}
~~~

#### Success Response

Status: 201

~~~json
{
  "message": "Match created successfully",
  "data": {
    "id": 25,
    "sport": "football",
    "homeTeam": "AC Milan",
    "awayTeam": "Inter Milan",
    "status": "scheduled",
    "startTime": "2026-03-23T18:00:00.000Z",
    "endTime": "2026-03-23T19:45:00.000Z",
    "homeScore": 0,
    "awayScore": 0,
    "createdAt": "2026-03-23T12:00:01.000Z"
  }
}
~~~

#### Validation Failure Example

Status: 400

~~~json
{
  "error": "Invalid payload",
  "details": [
    {
      "code": "custom",
      "path": ["endTime"],
      "message": "endTime must be after startTime"
    }
  ]
}
~~~

---

## 3. Commentary API

Commentary endpoints are nested under match id.

## 3.1 GET /api/matches/:id/commentary

Purpose:
- Fetch commentary entries for a specific match, newest first.

Path params:
- id required positive integer.

Query params:
- limit optional positive integer, max 100, default 100.

#### Postman Request

Method: GET
URL: http://localhost:8000/api/matches/25/commentary?limit=50

Headers:
- Accept: application/json
- User-Agent: PostmanRuntime/7.43.0

#### Success Response

Status: 200

~~~json
{
  "data": [
    {
      "id": 200,
      "matchId": 25,
      "minute": 42,
      "sequence": 9,
      "period": "1st half",
      "eventType": "shot",
      "actor": "Rafael Leao",
      "team": "AC Milan",
      "message": "Powerful strike saved by the keeper.",
      "metadata": {
        "xg": 0.18
      },
      "tags": ["attack", "chance"],
      "createdAt": "2026-03-23T12:16:07.000Z"
    }
  ]
}
~~~

#### Validation Failure Example

Status: 400

~~~json
{
  "error": "Invalid match id parameter",
  "details": [
    {
      "code": "too_small",
      "path": ["id"],
      "message": "Too small: expected number to be >0"
    }
  ]
}
~~~

## 3.2 POST /api/matches/:id/commentary

Purpose:
- Create commentary row for a match and broadcast commentary event to subscribers of that match.

Path params:
- id required positive integer.

Body contract:
- message required non-empty string.
- eventType required non-empty string.
- minute optional non-negative integer, default 0.
- sequence optional non-negative integer, default 0.
- period optional non-empty string.
- actor optional non-empty string.
- team optional non-empty string.
- metadata optional object.
- tags optional array of strings.

#### Postman Request

Method: POST
URL: http://localhost:8000/api/matches/25/commentary

Headers:
- Content-Type: application/json
- Accept: application/json
- User-Agent: PostmanRuntime/7.43.0

Body:

~~~json
{
  "minute": 12,
  "sequence": 1,
  "period": "1st half",
  "eventType": "kickoff",
  "actor": "Referee",
  "team": "AC Milan",
  "message": "Kickoff under bright lights.",
  "metadata": {
    "stadium": "San Siro"
  },
  "tags": ["start"]
}
~~~

#### Minimal Valid Body

~~~json
{
  "eventType": "update",
  "message": "General update"
}
~~~

#### Success Response

Status: 201

~~~json
{
  "data": {
    "id": 201,
    "matchId": 25,
    "minute": 12,
    "sequence": 1,
    "period": "1st half",
    "eventType": "kickoff",
    "actor": "Referee",
    "team": "AC Milan",
    "message": "Kickoff under bright lights.",
    "metadata": {
      "stadium": "San Siro"
    },
    "tags": ["start"],
    "createdAt": "2026-03-23T12:20:15.000Z"
  }
}
~~~

#### Validation Failure Example

Status: 400

~~~json
{
  "error": "Invalid commentary payload",
  "details": [
    {
      "code": "invalid_type",
      "path": ["tags"],
      "message": "Invalid input: expected array, received string"
    }
  ]
}
~~~

---

## 4. WebSocket Contract

Endpoint:
- ws://localhost:8000/ws

Connection behavior:
- On successful connection, server sends a Welcome payload.
- Security checks are applied at connection time.

## 4.1 Client -> Server Messages

Subscribe to a match stream:

~~~json
{ "type": "subscribe", "matchId": 25 }
~~~

Unsubscribe from a match stream:

~~~json
{ "type": "unsubscribe", "matchId": 25 }
~~~

## 4.2 Server -> Client Messages

Welcome:

~~~json
{ "type": "Welcome" }
~~~

Subscribe ack:

~~~json
{ "type": "subscribed", "matchId": 25 }
~~~

Unsubscribe ack:

~~~json
{ "type": "unsubscribed", "matchId": 25 }
~~~

Match created broadcast (all clients):

~~~json
{
  "type": "match_created",
  "data": {
    "id": 25,
    "sport": "football",
    "homeTeam": "AC Milan",
    "awayTeam": "Inter Milan"
  }
}
~~~

Commentary broadcast (subscribers only):

~~~json
{
  "type": "commentary",
  "data": {
    "id": 201,
    "matchId": 25,
    "eventType": "kickoff",
    "message": "Kickoff under bright lights."
  }
}
~~~

Malformed JSON error:

~~~json
{ "type": "error", "message": "Invalid JSON format" }
~~~

---

## 5. Postman Quick Start Collection Blueprint

Create a Postman collection named Sportz Backend with this folder layout:

- Health
  - GET /
- Matches
  - GET /api/matches
  - POST /api/matches
- Commentary
  - GET /api/matches/:id/commentary
  - POST /api/matches/:id/commentary

Use collection variables:

~~~text
baseUrl = http://localhost:8000
matchId = 25
~~~

Request URLs then become:
- {{baseUrl}}/
- {{baseUrl}}/api/matches
- {{baseUrl}}/api/matches/{{matchId}}/commentary

Recommended default headers:
- Accept: application/json
- Content-Type: application/json (POST only)
- User-Agent: PostmanRuntime/7.43.0

---

## 6. Validation Matrix

### Matches

- limit: optional, int, >0, <=100
- sport: required, non-empty string
- homeTeam: required, non-empty string
- awayTeam: required, non-empty string
- startTime: required ISO datetime
- endTime: required ISO datetime and > startTime
- homeScore: optional int >= 0
- awayScore: optional int >= 0

### Commentary

- id path param: required int > 0
- limit query: optional int > 0 and <=100
- eventType: required non-empty string
- message: required non-empty string
- minute: optional int >= 0, default 0
- sequence: optional int >= 0, default 0
- period: optional non-empty string
- actor: optional non-empty string
- team: optional non-empty string
- metadata: optional record object
- tags: optional array of strings

---

## 7. Contract Caveats

- There is no explicit route to update score or end matches yet.
- Data returned from DB includes createdAt timestamps and persisted defaults.
- WebSocket subscription state is process-local in memory.
- If scaling to multiple instances, add shared pub/sub and shared subscription coordination.
