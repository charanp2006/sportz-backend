# Backend Deep-Dive Documentation

This document explains each backend module and feature in implementation-level detail.

For request and response contracts with copy-paste Postman examples, see docs/api-contract-reference.md.

## 1. System Architecture

### 1.1 Overall Backend Architecture Flow

~~~mermaid
flowchart LR
    Client[REST Client] --> API[Express App]
    WSClient[WebSocket Client] --> WS[WebSocket Endpoint /ws]

    API --> Security[Arcjet HTTP Middleware]
    Security --> Matches[Matches Routes]
    Security --> Commentary[Commentary Routes]

    Matches --> MatchValidation[Zod Match Schemas]
    Commentary --> CommentaryValidation[Zod Commentary Schemas]

    MatchValidation --> Drizzle[Drizzle ORM]
    CommentaryValidation --> Drizzle

    Drizzle --> PG[(PostgreSQL)]

    Matches --> MatchBroadcast[Broadcast match_created]
    Commentary --> CommentaryBroadcast[Broadcast commentary]

    MatchBroadcast --> WS
    CommentaryBroadcast --> WS

    API --> APM[APM Insight Agent]
~~~

### 1.2 Component Interaction Diagram

~~~mermaid
flowchart TD
    subgraph HTTP Layer
      I[index.js]
      AR[arcjet.js]
      MR[routes/matches.js]
      CR[routes/commentary.js]
    end

    subgraph Domain Layer
      MS[utils/match-status.js]
      VM[validation/matches.js]
      VC[validation/commentary.js]
    end

    subgraph Data Layer
      DB[db/db.js]
      SCH[db/schema.js]
      SQL[drizzle migrations]
    end

    subgraph Realtime Layer
      WSS[ws/server.js]
      SUBS[in-memory subscription map]
    end

    subgraph Ops Layer
      SEED[seed/seed.js]
      APMCFG[apminsightnode.json]
    end

    I --> AR
    I --> MR
    I --> CR
    I --> WSS

    MR --> VM
    MR --> MS
    MR --> DB

    CR --> VC
    CR --> VM
    CR --> DB

    DB --> SCH
    SCH --> SQL

    MR --> WSS
    CR --> WSS
    WSS --> SUBS

    SEED --> MR
    SEED --> CR

    I --> APMCFG
~~~

### 1.3 Request Lifecycle End-to-End

~~~mermaid
sequenceDiagram
    participant U as Client
    participant E as Express
    participant S as Arcjet Middleware
    participant R as Route Handler
    participant V as Zod Schema
    participant O as Drizzle ORM
    participant D as PostgreSQL
    participant W as WebSocket Server

    U->>E: HTTP Request
    E->>S: Apply protect(req)
    S-->>E: Allow or deny
    alt Denied
      E-->>U: 403 or 429
    else Allowed
      E->>R: Execute route handler
      R->>V: safeParse(params/query/body)
      alt Validation fails
        R-->>U: 400 with issues
      else Validation passes
        R->>O: Build and execute query
        O->>D: SQL
        D-->>O: Rows
        O-->>R: Data
        R->>W: Optional broadcast event
        R-->>U: 200 or 201 response
      end
    end
~~~

### 1.4 Database Interaction Flow

~~~mermaid
flowchart TD
    A[Incoming validated input] --> B[Route constructs Drizzle query]
    B --> C[Drizzle translates to SQL]
    C --> D[(PostgreSQL)]
    D --> E[Rows returned]
    E --> F[Route response payload]

    G[drizzle.config.js] --> H[Schema path src/db/schema.js]
    H --> I[drizzle-kit generate]
    I --> J[Migration SQL files]
    J --> K[drizzle-kit migrate]
    K --> D
~~~

## 2. Data Model and Relationships

### 2.1 Entities

- match_status enum: scheduled, live, finished.
- matches table:
  - id, sport, home_team, away_team, status, start_time, end_time, home_score, away_score, created_at
- commentary table:
  - id, match_id, minute, sequence, period, event_type, actor, team, message, metadata, tags, created_at

### 2.2 Relationship

- One-to-many: matches -> commentary
- commentary.match_id references matches.id with ON DELETE CASCADE.

### 2.3 Schema Design Notes

- App uses camelCase property names mapped to snake_case columns.
- Timestamps are timezone-aware.
- Scores default to 0.
- Commentary metadata supports semi-structured event details via JSONB.

## 3. Feature Documentation

## 3.1 Feature: Match Management API

### Feature Overview

Manages sports match lifecycle records and exposes list/create endpoints.

### Endpoints

- GET /api/matches
- POST /api/matches

### Request and Response Structures

GET /api/matches
- Query:
  - limit optional, positive integer, max 100, default 50.
- Success response:
~~~json
{ "data": [ { "id": 1, "sport": "football" } ] }
~~~

POST /api/matches
- Body:
  - sport, homeTeam, awayTeam required strings.
  - startTime and endTime required ISO date-time strings.
  - homeScore and awayScore optional non-negative integers.
- Success response:
~~~json
{
  "message": "Match created successfully",
  "data": {
    "id": 101,
    "sport": "football",
    "status": "scheduled"
  }
}
~~~

### Business Logic

- Input validated with createMatchSchema and listMatchesQuerySchema.
- Status derived dynamically from start/end timestamps using getMatchStatus.
- New matches are broadcast to all connected WebSocket clients.

### Error Handling and Edge Cases

- Validation errors return 400 with details array.
- Database failures return 500.
- Invalid datetime values in status utility return null status, but route validation prevents invalid create payloads.

### High-Level Workflow

~~~mermaid
flowchart LR
    A[POST /api/matches] --> B[Validate body]
    B --> C[Compute status]
    C --> D[Insert row in matches]
    D --> E[Broadcast match_created]
    E --> F[Return 201]
~~~

### Detailed Workflow

~~~mermaid
flowchart TD
    A[Receive request] --> B{Body valid?}
    B -- No --> C[Return 400 + issues]
    B -- Yes --> D[Extract startTime/endTime/scores]
    D --> E[Convert ISO strings to Date]
    E --> F[Compute status via getMatchStatus]
    F --> G[Drizzle insert into matches]
    G --> H{Insert success?}
    H -- No --> I[Return 500]
    H -- Yes --> J[Try broadcast to ws clients]
    J --> K[Return 201 + created event]
~~~

### Sequence Diagram

~~~mermaid
sequenceDiagram
    participant C as Client
    participant M as matchesRouter
    participant V as createMatchSchema
    participant U as match-status utility
    participant O as Drizzle
    participant P as PostgreSQL
    participant W as WebSocket server

    C->>M: POST /api/matches
    M->>V: safeParse(body)
    alt invalid
      M-->>C: 400
    else valid
      M->>U: getMatchStatus(startTime,endTime)
      U-->>M: scheduled/live/finished
      M->>O: insert(matches).returning()
      O->>P: INSERT
      P-->>O: created row
      O-->>M: event
      M->>W: broadcastMatchCreated(event)
      M-->>C: 201 with event
    end
~~~

## 3.2 Feature: Commentary API (Nested)

### Feature Overview

Stores and retrieves commentary events scoped to a match id.

### Endpoints

- GET /api/matches/:id/commentary
- POST /api/matches/:id/commentary

### Request and Response Structures

GET /api/matches/:id/commentary
- Path params: id positive integer.
- Query: limit optional positive integer max 100 default 100.
- Response:
~~~json
{ "data": [ { "id": 7, "matchId": 101, "message": "Kickoff" } ] }
~~~

POST /api/matches/:id/commentary
- Path params: id positive integer.
- Body:
  - message required non-empty string.
  - eventType required non-empty string.
  - minute and sequence optional with defaults.
  - period, actor, team optional strings.
  - metadata optional object.
  - tags optional string array.
- Response:
~~~json
{ "data": { "id": 8, "matchId": 101, "message": "Goal" } }
~~~

### Business Logic

- Route uses mergeParams true to access parent route id.
- Params validated with matchIdParamSchema.
- Query/body validated with commentary schemas.
- Read query applies match filter, descending createdAt sort, and capped limit.
- Create query inserts commentary row and broadcasts to match subscribers.

### Error Handling and Edge Cases

- Invalid path or query values: 400.
- Invalid body shape: 400.
- DB failures: 500 with logged server error.
- Missing subscribers: broadcast becomes no-op.

### High-Level Workflow

~~~mermaid
flowchart LR
    A[POST /api/matches/:id/commentary] --> B[Validate id + body]
    B --> C[Insert commentary row]
    C --> D[Broadcast commentary to match subscribers]
    D --> E[Return 201]
~~~

### Detailed Workflow

~~~mermaid
flowchart TD
    A[Receive nested request] --> B{Params valid?}
    B -- No --> C[Return 400 invalid match id]
    B -- Yes --> D{Payload valid?}
    D -- No --> E[Return 400 invalid commentary payload]
    D -- Yes --> F[Insert with matchId from params]
    F --> G{Insert success?}
    G -- No --> H[Log error and return 500]
    G -- Yes --> I[Try ws broadcastCommentary(matchId,data)]
    I --> J[Return 201 with created commentary]
~~~

### Sequence Diagram

~~~mermaid
sequenceDiagram
    participant C as Client
    participant R as commentaryRouter
    participant VP as matchIdParamSchema
    participant VB as createCommentarySchema
    participant O as Drizzle
    participant P as PostgreSQL
    participant W as WebSocket server

    C->>R: POST /api/matches/101/commentary
    R->>VP: safeParse(params)
    alt invalid params
      R-->>C: 400
    else params ok
      R->>VB: safeParse(body)
      alt invalid body
        R-->>C: 400
      else valid
        R->>O: insert(commentary).returning()
        O->>P: INSERT
        P-->>O: row
        O-->>R: createdCommentary
        R->>W: broadcastCommentary(matchId, row)
        R-->>C: 201
      end
    end
~~~

## 3.3 Feature: Real-Time WebSocket Notifications

### Feature Overview

Provides pub/sub style live updates for match creation and commentary events.

### Protocol Summary

Client messages:
- subscribe with integer matchId
- unsubscribe with integer matchId

Server messages:
- Welcome
- subscribed and unsubscribed acknowledgements
- match_created broadcast to all clients
- commentary broadcast to subscribers of specific match
- error for malformed JSON payload

### Business Logic

- Subscriptions stored in Map keyed by matchId.
- Each socket holds a Set of active subscriptions.
- On close, cleanup removes socket from all match sets.
- Heartbeat ping/pong terminates stale connections.
- Arcjet protection is applied at websocket connection handshake.

### Error Handling and Edge Cases

- Invalid JSON returns socket-level error message.
- Denied Arcjet decision closes connection with policy/rate-limit code.
- If socket send attempted while not OPEN, send is skipped with log.
- Unknown message types are ignored.

### High-Level Workflow

~~~mermaid
flowchart LR
    A[Client opens ws /ws] --> B[Arcjet ws protect]
    B --> C[Connection accepted]
    C --> D[Client subscribes to match]
    D --> E[Server stores subscription]
    E --> F[HTTP route writes trigger broadcasts]
~~~

### Detailed Workflow

~~~mermaid
flowchart TD
    A[Incoming ws connection] --> B{Arcjet allows?}
    B -- No --> C[Close socket with policy code]
    B -- Yes --> D[Initialize isAlive and subscription Set]
    D --> E[Send Welcome]
    E --> F[Receive message]
    F --> G{Valid JSON?}
    G -- No --> H[Send error invalid json]
    G -- Yes --> I{subscribe or unsubscribe?}
    I -- subscribe --> J[Add socket to matchSubcribers map]
    I -- unsubscribe --> K[Remove socket from map]
    I -- other --> L[Ignore]
    J --> M[Send subscribed ack]
    K --> N[Send unsubscribed ack]
    D --> O[Heartbeat ping/pong loop]
    O --> P[Terminate dead sockets]
~~~

### Sequence Diagram

~~~mermaid
sequenceDiagram
    participant U as WS Client
    participant S as ws/server.js
    participant A as Arcjet ws rule set
    participant M as matchSubcribers map

    U->>S: connect /ws
    S->>A: protect(req)
    alt denied
      S-->>U: close 1008 or 1013
    else allowed
      S-->>U: Welcome
      U->>S: {type: subscribe, matchId: 101}
      S->>M: add socket under 101
      S-->>U: subscribed ack
      Note over S,U: Later commentary insert happens via HTTP route
      S-->>U: {type: commentary, data: ...}
      U->>S: {type: unsubscribe, matchId: 101}
      S->>M: remove socket under 101
      S-->>U: unsubscribed ack
    end
~~~

## 3.4 Feature: Security and Request Protection (Arcjet)

### Feature Overview

Centralized middleware applies a consistent security policy across HTTP and WebSocket paths.

### Rules in Use

- shield
- detectBot with allowlist categories SEARCH_ENGINE and PREVIEW
- slidingWindow
  - HTTP: 10s interval, max 50
  - WS: 2s interval, max 5

### Business Logic

- If ARCJET_KEY missing at startup, module throws and service fails fast.
- For denied HTTP decisions:
  - rate-limit reason => 429
  - other denials => 403
- On Arcjet runtime errors, middleware returns 503.

### Error Handling and Edge Cases

- Missing User-Agent can trigger detectBot errors.
- Missing client IP/fingerprint context in production proxy chains can cause protect errors.
- Middleware currently fails closed on Arcjet exceptions for HTTP, and closes WS on exception.

### High-Level Workflow

~~~mermaid
flowchart LR
    A[Incoming request] --> B[Arcjet protect]
    B --> C{Decision}
    C -- allow --> D[Route handler]
    C -- deny rate limit --> E[429]
    C -- deny other --> F[403]
    B --> G[Exception path]
    G --> H[503]
~~~

### Detailed Workflow

~~~mermaid
flowchart TD
    A[Build arcjet instances] --> B[Register shield/detectBot/slidingWindow]
    B --> C[Request enters securityMiddleware]
    C --> D{httpArcjet exists?}
    D -- no --> E[next]
    D -- yes --> F[await protect(req)]
    F --> G{Denied?}
    G -- no --> E
    G -- yes --> H{Rate limit reason?}
    H -- yes --> I[Return 429]
    H -- no --> J[Return 403]
    F --> K[Exception]
    K --> L[Log Arcjet error]
    L --> M[Return 503]
~~~

### Sequence Diagram

~~~mermaid
sequenceDiagram
    participant C as Client
    participant E as Express
    participant M as securityMiddleware
    participant A as Arcjet HTTP instance

    C->>E: HTTP request
    E->>M: execute middleware
    M->>A: protect(req)
    alt denied rate limit
      M-->>C: 429
    else denied policy
      M-->>C: 403
    else allowed
      M-->>E: next()
      E-->>C: route response
    else exception
      M-->>C: 503
    end
~~~

## 3.5 Feature: Seeding Engine

### Feature Overview

Seeds the system by calling public REST endpoints rather than writing directly to the database.

### Endpoint Usage

- GET /api/matches
- POST /api/matches
- POST /api/matches/:id/commentary

### Business Logic

- Loads data from src/data/data.json.
- Supports data shapes: array, or object with commentary/feed and optional matches.
- Creates missing matches and maps template commentary across generated matches.
- Reorders cricket feed to keep innings and team context coherent.
- Inserts commentary progressively with configurable delay.

### Error Handling and Edge Cases

- Throws when API_URL is missing.
- Throws when feed shape is invalid.
- Throws when no matches found/created.
- Skips feed entries with unresolved match mapping.
- Score update and match-finish operations are intentionally commented out pending future endpoints.

### High-Level Workflow

~~~mermaid
flowchart LR
    A[Read data.json] --> B[Fetch existing matches]
    B --> C[Create missing matches]
    C --> D[Expand and randomize commentary feed]
    D --> E[Insert commentary through API]
    E --> F[Delay and continue]
~~~

### Detailed Workflow

~~~mermaid
flowchart TD
    A[Start seed script] --> B[Load feed and match templates]
    B --> C[GET /api/matches]
    C --> D[Build map of target matches]
    D --> E{Template matches provided?}
    E -- yes --> F[Create missing template matches via POST /api/matches]
    E -- no --> G[Use existing matches]
    F --> H[Expand feed to uncovered matches]
    G --> H
    H --> I[Randomize by match with anti-repeat]
    I --> J[Loop commentary entries]
    J --> K{match target exists?}
    K -- no --> L[Warn and skip]
    K -- yes --> M[POST /api/matches/:id/commentary]
    M --> N[Log inserted message]
    N --> O[Wait DELAY_MS]
    O --> J
~~~

### Sequence Diagram

~~~mermaid
sequenceDiagram
    participant S as seed.js
    participant API as Express API
    participant MR as matchesRouter
    participant CR as commentaryRouter
    participant DB as PostgreSQL

    S->>API: GET /api/matches
    API->>MR: list
    MR->>DB: SELECT matches
    DB-->>MR: rows
    MR-->>S: matches

    loop For missing template matches
      S->>API: POST /api/matches
      API->>MR: create
      MR->>DB: INSERT match
      DB-->>MR: row
      MR-->>S: created match
    end

    loop For each commentary event
      S->>API: POST /api/matches/:id/commentary
      API->>CR: create
      CR->>DB: INSERT commentary
      DB-->>CR: row
      CR-->>S: created commentary
    end
~~~

## 3.6 Feature: Database and ORM Layer

### Feature Overview

Drizzle ORM with node-postgres pool handles all persistence.

### Responsibilities

- db/db.js initializes pool and Drizzle instance.
- db/schema.js defines enum and table metadata.
- drizzle.config.js binds schema path and migration output path.
- drizzle SQL tracks migration history and snapshot metadata.

### Data Access Patterns in Code

- SELECT with sorting and limits.
- INSERT with returning clause.
- WHERE filtering via eq.
- ORDER BY descending created_at for newest-first reads.

### High-Level Workflow

~~~mermaid
flowchart LR
    A[Route handler] --> B[Drizzle query builder]
    B --> C[pg pool]
    C --> D[(PostgreSQL)]
    D --> E[rows]
    E --> F[JSON response]
~~~

### Detailed Workflow

~~~mermaid
flowchart TD
    A[App startup] --> B[Validate DATABASE_URL]
    B --> C[Create pg Pool]
    C --> D[Instantiate drizzle(pool)]
    D --> E[Routes import db]
    E --> F[Execute SQL through Drizzle]
    F --> G[Map DB rows to response objects]

    H[Schema update] --> I[drizzle-kit generate]
    I --> J[Migration SQL file]
    J --> K[drizzle-kit migrate]
    K --> L[Database schema updated]
~~~

### Sequence Diagram

~~~mermaid
sequenceDiagram
    participant R as Route
    participant D as Drizzle
    participant P as pg Pool
    participant G as PostgreSQL

    R->>D: build query
    D->>P: execute SQL
    P->>G: query
    G-->>P: result rows
    P-->>D: rows
    D-->>R: mapped data
~~~

## 3.7 Feature: Input Validation Layer

### Feature Overview

Zod schemas enforce request contracts for matches and commentary modules.

### Modules

- validation/matches.js
- validation/commentary.js

### Notable Rules

- Coercion for numeric params and query values.
- Hard cap limit <= 100.
- Match time chronology validation with superRefine.
- Commentary optional fields and defaults to support sparse event payloads.

### High-Level Workflow

~~~mermaid
flowchart LR
    A[Incoming params/query/body] --> B[Zod safeParse]
    B --> C{success?}
    C -- no --> D[400 with issues]
    C -- yes --> E[Use parsed data in route]
~~~

### Detailed Workflow

~~~mermaid
flowchart TD
    A[Router receives request] --> B[Run safeParse on params]
    B --> C{params valid?}
    C -- no --> D[Return 400]
    C -- yes --> E[Run safeParse on query/body]
    E --> F{payload valid?}
    F -- no --> G[Return 400 issues]
    F -- yes --> H[Use parsed/coerced/defaulted values]
    H --> I[Query DB]
~~~

### Sequence Diagram

~~~mermaid
sequenceDiagram
    participant C as Client
    participant R as Router
    participant Z as Zod Schema
    participant DB as Drizzle/Postgres

    C->>R: Request with raw input
    R->>Z: safeParse(raw)
    alt parse failed
      Z-->>R: issues[]
      R-->>C: 400 + issues
    else parse passed
      Z-->>R: normalized data
      R->>DB: execute query
      DB-->>R: result
      R-->>C: success response
    end
~~~

## 4. Module-by-Module Reference

### index.js

Purpose:
- Bootstraps Express and HTTP server.
- Registers middleware and routes.
- Attaches WebSocket server.
- Stores broadcast callbacks in app.locals.

### arcjet.js

Purpose:
- Builds Arcjet instances for HTTP and WebSocket contexts.
- Exposes securityMiddleware for Express.

### db/db.js

Purpose:
- Initializes PostgreSQL pool and Drizzle client.

### db/schema.js

Purpose:
- Defines enum, matches table, commentary table, and FK relationship.

### routes/matches.js

Purpose:
- Implements list and create operations for matches.

### routes/commentary.js

Purpose:
- Implements nested list/create operations for commentary by match.

### ws/server.js

Purpose:
- Hosts /ws endpoint and subscription registry.
- Broadcasts match and commentary events.

### seed/seed.js

Purpose:
- API-driven fixture seeding and commentary simulation logic.

### utils/match-status.js

Purpose:
- Derives status from match schedule windows.

### validation/*.js

Purpose:
- Defines schemas used by route layer validation.

## 5. External Integrations

### PostgreSQL (Neon-compatible)

- Accessed through pg pool and Drizzle ORM.

### Arcjet

- Used for HTTP and WebSocket request protection.

### APM Insight

- Initialized at process startup via AgentAPI.config.
- Configurable through apminsightnode.json and environment variables.

## 6. Key Design Decisions and Trade-Offs

- Chosen route-centric architecture over service/controller split for low complexity and fast iteration.
- Broadcast callbacks passed through app.locals to avoid cyclic imports.
- In-memory WebSocket subscription map is simple and fast but process-local; horizontal scaling requires shared broker/state.
- Seed engine intentionally uses API surface to validate end-to-end behavior rather than bypassing business rules via direct DB writes.

## 7. Known Constraints and Extension Guidance

Current constraints:
- No score update endpoint yet, although validation/schema support score fields.
- No explicit pagination cursor model; reads are limit-based only.
- WebSocket auth model is rule-based and currently does not include domain user auth.

Recommended extensions:
- Add dedicated service layer as domain logic grows.
- Add transactional writes when multi-step operations are introduced.
- Add integration tests for routes + DB + WebSocket broadcast assertions.
- Add persistent pub/sub backend (Redis, NATS, Kafka) for multi-instance deployments.

## 8. Quick Onboarding Workflow

1. Configure .env.
2. Run migrations.
3. Start server.
4. Create match through POST /api/matches.
5. Subscribe over WebSocket with matchId.
6. POST commentary and observe pushed events.
7. Run seed script to generate stream-like traffic.
