# Sportz Backend

A real-time sports backend built with Node.js, Express, PostgreSQL, Drizzle ORM, WebSocket streaming, and request protection with Arcjet.

## Project Overview

This backend powers match creation, commentary ingestion, commentary retrieval, and live event broadcast.

Core problems solved:
- Persisting structured sports match data in PostgreSQL.
- Capturing real-time commentary events per match.
- Broadcasting updates to subscribed WebSocket clients.
- Validating all API inputs before database writes.
- Protecting HTTP and WebSocket traffic with bot/rate-limit/security rules.

## Tech Stack

- Runtime: Node.js (ES Modules)
- HTTP API: Express
- Database: PostgreSQL (Neon-compatible)
- ORM: Drizzle ORM
- Migrations: Drizzle Kit
- Validation: Zod
- Real-time: ws (WebSocket server)
- Security: Arcjet
- Observability: APM Insight

## Key Dependencies

- express
- drizzle-orm
- drizzle-kit
- pg
- zod
- ws
- @arcjet/node
- apminsight
- dotenv

## High-Level Architecture

~~~mermaid
flowchart TD
    C[HTTP Client] --> E[Express API]
    WC[WebSocket Client] --> WSS[WebSocket Server]

    E --> SEC[Arcjet HTTP Middleware]
    SEC --> R1[Matches Router]
    SEC --> R2[Commentary Router]

    R1 --> V1[Zod Validation]
    R2 --> V2[Zod Validation]

    V1 --> DBL[Drizzle ORM Layer]
    V2 --> DBL

    DBL --> PG[(PostgreSQL)]

    R1 --> B1[Broadcast Match Created]
    R2 --> B2[Broadcast Commentary]

    B1 --> WSS
    B2 --> WSS

    WSS --> SUB[Match Subscription Map]
    SUB --> WC

    E --> APM[APM Insight]
~~~

## Setup and Installation

1. Install dependencies

~~~bash
npm install
~~~

2. Configure environment variables

Create .env in the server root and set required values.

3. Run migrations

~~~bash
npm run db:generate
npm run db:migrate
~~~

4. Start server

~~~bash
npm run dev
~~~

5. Optional: Seed data through API

~~~bash
npm run seed
~~~

## Environment Variables

Required for runtime:
- DATABASE_URL: PostgreSQL connection string.
- PORT: HTTP server port (default 8000).
- HOST: Bind host (default 0.0.0.0).
- ARCJET_KEY: Arcjet API key.

Optional:
- ARCJET_MODE: DRY_RUN or LIVE (defaults to LIVE when unset).
- ARCJET_ENV: Used in operational conventions for dev/prod switching.
- API_URL: Base API URL used by seeding script.
- DELAY_MS: Delay between seeded commentary inserts.
- SEED_MATCH_DURATION_MINUTES: Match duration fallback for seeded matches.
- SEED_FORCE_LIVE: When true-like, seed script prefers/creates live-window matches.
- APMINSIGHT_LICENSE_KEY: APM Insight license key.
- APMINSIGHT_APP_NAME: APM Insight application name.
- APMINSIGHT_APP_PORT: Preferred env name for APM port mapping.
- APMINSIGHT_PORT: Current project env name used in local config conventions.

Security note:
- Keep .env out of source control.
- Rotate exposed secrets if any credential was ever committed.

## API Overview

### Health
- GET /

### Matches Module
- GET /api/matches
- POST /api/matches

### Commentary Module (Nested Under Match)
- GET /api/matches/:id/commentary
- POST /api/matches/:id/commentary

## Request and Response Summary

### GET /api/matches
Query:
- limit optional positive integer max 100.

Response 200:
~~~json
{ "data": [ { "id": 1, "sport": "football" } ] }
~~~

### POST /api/matches
Body:
- sport, homeTeam, awayTeam required non-empty strings.
- startTime, endTime required ISO datetime strings.
- homeScore, awayScore optional non-negative integers.

Response 201:
~~~json
{ "message": "Match created successfully", "data": { "id": 42 } }
~~~

### GET /api/matches/:id/commentary
Path params:
- id required positive integer.

Query:
- limit optional positive integer max 100, default 100.

Response 200:
~~~json
{ "data": [ { "id": 10, "matchId": 42, "message": "Goal" } ] }
~~~

### POST /api/matches/:id/commentary
Path params:
- id required positive integer.

Body:
- message required non-empty string.
- eventType required non-empty string.
- minute, sequence optional non-negative integers with defaults.
- period, actor, team optional strings.
- metadata optional object.
- tags optional array of strings.

Response 201:
~~~json
{ "data": { "id": 11, "matchId": 42, "message": "Kickoff" } }
~~~

## Folder Structure

~~~text
server/
  src/
    index.js               # Application bootstrap
    arcjet.js              # Arcjet HTTP and WS protection setup
    db/
      db.js                # Drizzle + pg pool initialization
      schema.js            # Tables and enum definitions
    routes/
      matches.js           # Match endpoints
      commentary.js        # Nested commentary endpoints
    validation/
      matches.js           # Match-related Zod schemas
      commentary.js        # Commentary-related Zod schemas
    ws/
      server.js            # WebSocket server and subscriptions
    seed/
      seed.js              # API-driven seed workflow
    utils/
      match-status.js      # Match lifecycle status computation
  drizzle/
    0000_nervous_speed_demon.sql
  drizzle.config.js
  apminsightnode.json
~~~

## Design Decisions and Patterns

- Thin-route pattern: route handlers combine validation, orchestration, persistence, and response formatting.
- Schema-first validation: all external inputs are validated with Zod before persistence.
- Nested commentary routing: commentary is scoped by match id in route design.
- Broadcast-on-write: successful match/commentary creation emits WebSocket events immediately.
- Shared process memory subscriptions: WebSocket subscriptions are maintained in an in-memory map.
- Drizzle SQL builder: strongly-typed query construction and migration generation.
- Defensive security wrapper: centralized middleware enforces Arcjet rules before route execution.

## Operational Notes

- WebSocket endpoint: /ws
- Subscription protocol:
  - Send { "type": "subscribe", "matchId": 1 }
  - Send { "type": "unsubscribe", "matchId": 1 }
- Server sends:
  - match_created events to all clients.
  - commentary events only to subscribers of a match.

## Detailed Documentation

See the deep-dive backend documentation at docs/backend-architecture.md.
See the API contract and Postman-ready examples at docs/api-contract-reference.md.
