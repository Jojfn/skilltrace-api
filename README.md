# SkillTrace API

A backend service that turns capstone contribution data into verified,
SFIA-mapped evidence a student can show an employer.

**SIT753 Professional Practice in IT — Task 7.3HD (DevOps Pipeline with Jenkins)**
Jason Hu · Student ID 219220123

This repository exists to be built, tested, scanned, deployed, released and
monitored by the seven-stage Jenkins pipeline defined in [`Jenkinsfile`](Jenkinsfile).

---

## What the application does

| Capability | Detail |
|---|---|
| Authentication | Registration and login, bcrypt password hashing, JWT bearer tokens |
| Authorisation | Role-based access control — `student` and `owner` roles are enforced per route |
| Evidence CRUD | Create, read, update and delete evidence statements, scoped to their owner |
| Endorsement workflow | `draft → submitted → endorsed / declined`, with state transitions guarded server-side |
| SFIA skill mapping | Deterministic rule-based mapper turning raw contribution text into SFIA 8 skill codes, confidence scores and a proposed responsibility level |
| Observability | `/health` for liveness and build identity, `/metrics` in Prometheus exposition format |

### API surface

```
POST   /api/auth/register          create an account (student or owner)
POST   /api/auth/login             exchange credentials for a JWT
GET    /api/auth/me                the caller's own profile

POST   /api/evidence               create an evidence statement (draft)
GET    /api/evidence               list the caller's evidence
GET    /api/evidence/:id           read one statement
PUT    /api/evidence/:id           edit a statement that is not yet endorsed
DELETE /api/evidence/:id           delete own statement
POST   /api/evidence/:id/submit    submit for endorsement (requires a result)
POST   /api/evidence/:id/endorse   owner only — endorse submitted evidence
POST   /api/evidence/:id/decline   owner only — decline with a reason

GET    /api/skills/catalogue       public list of supported SFIA skills
POST   /api/skills/map             map contributions to skills and a level

GET    /health                     status, environment, version, build, commit
GET    /metrics                    Prometheus metrics
```

### Design decisions worth knowing

- **Endorsed evidence is immutable.** An endorsement vouches for specific
  wording, so allowing edits afterwards would let a student alter a claim
  someone else had already signed. `PUT` returns `409` once endorsed.
- **Login does not leak account existence.** An unknown email and a wrong
  password return an identical `401`, so the endpoint cannot be used to
  enumerate registered users. There is a test asserting the two responses match.
- **Production refuses to start insecurely.** `assertProductionConfig()` throws
  if `NODE_ENV=production` with the development signing key, a short secret, or
  fault injection enabled.
- **No native dependencies.** Persistence is an atomic file-backed store rather
  than a database driver, so `npm ci` never needs a compiler and the pipeline
  runs on any agent.

---

## Technology

| Layer | Choice |
|---|---|
| Runtime | Node.js 24, CommonJS |
| Web framework | Express 4 |
| Auth | jsonwebtoken (HS256), bcryptjs |
| Metrics | prom-client |
| Testing | Jest 29 + Supertest, reported as JUnit XML |
| Linting | ESLint 8 + eslint-plugin-security |
| Code quality | SonarCloud with a gating quality gate |
| Process management | PM2 |
| Monitoring | Prometheus 3 with alerting rules |
| CI/CD | Jenkins declarative pipeline |

---

## Running locally

```bash
npm ci
npm test          # 74 tests, unit + integration
npm run lint
npm start         # http://localhost:3000
```

---

## The pipeline

| # | Stage | What it does | Fails the build when |
|---|---|---|---|
| 1 | **Build** | `npm ci`, stamps version/build/commit, assembles `dist/app`, installs production-only dependencies, zips a self-contained artefact and archives it | Install or packaging fails |
| 2 | **Test** | Jest unit + integration suites with coverage, published as JUnit | Any test fails |
| 3 | **Code Quality** | ESLint, then SonarCloud analysis; waits for the server-side task and reads the quality gate | The SonarCloud quality gate is red |
| 4 | **Security** | `npm audit`, `eslint-plugin-security`, and a secret scan over tracked files | Any high or critical dependency vulnerability |
| 5 | **Deploy** | Unpacks the artefact to a numbered release directory, points `current` at it, starts it under PM2 on :3101, then runs an end-to-end smoke test | Smoke test fails |
| 6 | **Release** | Tags the commit `v1.0.<build>` and pushes it, then promotes **the same artefact** to production on :3100 | Promotion fails — production is rolled back automatically |
| 7 | **Monitoring** | Ensures Prometheus is running with this repo's config, verifies production is scraped, reports live metrics, then injects faults into staging to prove an alert fires and recovers | Production is not up in Prometheus |

### Promotion model

```
                build once
                    |
             [ artefact.zip ] --- archived in Jenkins
                    |
        +-----------+-----------+
        |                       |
   staging :3101           production :3100
   (ALLOW_CHAOS=1)         (ALLOW_CHAOS=0)
```

The artefact is built once and promoted unchanged, so production runs exactly
what staging verified. Each environment keeps previous releases side by side and
`current` is a junction, which makes rollback a repoint rather than a rebuild.

### Environments

| | Staging | Production |
|---|---|---|
| Port | 3101 | 3100 |
| Fault injection | enabled | **disabled** |
| Signing key | generated at first deploy, stored outside the repo | generated at first deploy, stored outside the repo |
| Root | `C:\skilltrace\staging` | `C:\skilltrace\prod` |

### Monitoring and alerting

Prometheus scrapes both environments every 10 seconds. Three alert rules are
defined in [`monitoring/alert.rules.yml`](monitoring/alert.rules.yml):

| Alert | Condition | Severity |
|---|---|---|
| `SkillTraceInstanceDown` | `up == 0` for 30s | critical |
| `SkillTraceHighErrorRate` | 5xx rate above 10% for 30s | critical |
| `SkillTraceHighLatency` | p95 latency above 500ms for 1m | warning |

The Monitoring stage proves the second rule works rather than asserting it: it
fires 40 failing requests at the **staging** `/debug/boom` endpoint, waits for
the alert to reach `firing`, then restores healthy traffic so it recovers.
Production is never touched by the simulation — `/debug/boom` only exists when
`ALLOW_CHAOS=1`, which production refuses to start with.

---

## Repository layout

```
src/            application code (routes, middleware, lib, metrics)
tests/          unit and integration suites
ci/             pipeline stage scripts (deploy, rollback, smoke, security, quality, monitoring)
monitoring/     Prometheus scrape config and alert rules
scripts/        build-time artefact assembly
Jenkinsfile     the seven-stage pipeline
ecosystem.config.js   PM2 process definitions
```
