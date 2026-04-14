# Jobs And Redis Refactor Architecture

This document shows the **legacy / pre-refactor shape** of background jobs and
the **current refactored architecture** in this repo.

The **new architecture** is based on the current code in:

- `apps/api/src/job-queue/*`
- `apps/api/src/api/Job/job-status.service.ts`
- `apps/api/src/api/assignment/v2/services/job-status.service.ts`
- `apps/api/src/api/attempt/services/attempt.service.ts`
- `apps/jobs/src/job-worker.service.ts`

The **old architecture** is an **inference** of the design this refactor is
replacing: API-owned job orchestration with worker execution assumed to be
co-located with the API runtime and Redis used mostly as a shared queue/state
backplane.

## Old Architecture (Inferred, Pre-Refactor)

````mermaid
flowchart LR
    Client["Client / Frontend"]
    API["Mark API"]
    Controllers["Assignment / Attempt Controllers"]
    Services["Assignment / Attempt Services"]
    LegacyStatus["Legacy JobStatusService V1/V2"]
    Redis[(Redis)]
    Queue["Queue Entries"]
    Worker["Worker Execution<br/>assumed in API runtime / same deploy unit"]
    Domain["Assignment / Grading Logic"]
    SSE["SSE Status Stream"]

    Client --> API
    API --> Controllers
    Controllers --> Services
    Services --> LegacyStatus
    LegacyStatus --> Redis
    Services --> Queue
    Queue --> Redis
    Redis --> Worker
    Worker --> Domain
    Domain --> LegacyStatus
    LegacyStatus --> Redis
    Redis --> SSE
    SSE --> Client

    classDef old fill:#fef3c7,stroke:#b45309,color:#111827;
    class API,Controllers,Services,LegacyStatus,Worker old;
````

### Legacy characteristics

- API request handling and background execution were tightly coupled.
- Redis acted as a shared backing store, but responsibilities were not clearly
  separated by concern.
- Job lifecycle, queue consumption, and domain execution were effectively part
  of one logical runtime.
- Scaling API traffic and scaling workers were harder to reason about
  independently.

## New Architecture (Current Refactor)

````mermaid
flowchart LR
    Client[Client / Frontend]

    subgraph API["apps/api"]
        Controllers[Controllers]
        AppServices[Assignment / Attempt / Admin Services]
        JobStatus[JobStatusService V1/V2]
        JobState[JobStateService]
        JobQueue[JobQueueService]
        Executor["JobExecutorController + JobExecutorService"]
        WorkerHealth[JobWorkerConnectionService]
        SSE[SSE Job Status Stream]
    end

    subgraph Redis["Redis"]
        BullQueues["BullMQ queues\nmark.assignment.v1\nmark.assignment.v2\nmark.attempt\nmark.admin.translation"]
        JobHashes["Job state hashes\nmark:jobs:state:{jobId}"]
        ActiveLocks["Active job locks\nmark:jobs:active:{hash}"]
        PubSub["Pub/Sub channels\nmark:jobs:events:{jobId}"]
        Heartbeats["Worker heartbeats\nmark.jobs.worker.heartbeat:*"]
    end

    subgraph Jobs["apps/jobs"]
        BullWorkers["BullMQ Workers"]
        PayloadDecrypt["Decrypt payload"]
        ApiCallback["POST /api/internal/jobs/execute"]
    end

    subgraph Domain["Domain execution inside apps/api"]
        AssignmentJobs["Assignment publish / generate"]
        AttemptJobs["Attempt grading / author preview"]
        AdminJobs["Admin translation maintenance"]
    end

    Client --> Controllers
    Controllers --> AppServices
    AppServices --> JobStatus
    JobStatus --> JobState
    AppServices --> JobQueue
    AppServices --> SSE

    JobState --> JobHashes
    JobState --> ActiveLocks
    JobState --> PubSub
    WorkerHealth --> Heartbeats

    JobQueue --> BullQueues
    BullQueues --> BullWorkers
    BullWorkers --> PayloadDecrypt
    BullWorkers --> Heartbeats
    PayloadDecrypt --> ApiCallback
    ApiCallback --> Executor
    Executor --> AssignmentJobs
    Executor --> AttemptJobs
    Executor --> AdminJobs

    AssignmentJobs --> JobState
    AttemptJobs --> JobState
    AdminJobs --> JobState

    PubSub --> SSE
    SSE --> Client

    classDef api fill:#dbeafe,stroke:#1d4ed8,color:#111827;
    classDef redis fill:#ecfdf5,stroke:#047857,color:#111827;
    classDef jobs fill:#ede9fe,stroke:#6d28d9,color:#111827;
    classDef domain fill:#fce7f3,stroke:#be185d,color:#111827;

    class Controllers,AppServices,JobStatus,JobState,JobQueue,Executor,WorkerHealth,SSE api;
    class BullQueues,JobHashes,ActiveLocks,PubSub,Heartbeats redis;
    class BullWorkers,PayloadDecrypt,ApiCallback jobs;
    class AssignmentJobs,AttemptJobs,AdminJobs domain;
````

## What Redis Does Now

Redis is no longer just "the queue". It has four distinct responsibilities:

1. **BullMQ queue transport**
   - Queue names are defined in `apps/api/src/job-queue/job-queue.constants.ts`.
   - `JobQueueService` writes encrypted jobs into BullMQ queues.

2. **Job state store**
   - `JobStateService` stores the canonical job record in Redis hashes:
     `mark:jobs:state:{jobId}`.

3. **Active-job locking**
   - `JobStateService.acquireActiveJobLock()` uses Redis `SET ... NX` for
     deduplication via `mark:jobs:active:{hash}`.
   - This is how grading jobs avoid duplicate concurrent work for the same
     attempt / author preview key.

4. **Realtime status fan-out**
   - `JobStateService.updateJobStatus()` publishes to
     `mark:jobs:events:{jobId}`.
   - SSE endpoints subscribe through `getJobStatusStream()` and forward updates
     back to the client.

5. **Worker liveness**
   - `apps/jobs` writes heartbeat keys under
     `mark.jobs.worker.heartbeat:*`.
   - `JobWorkerConnectionService` in the API watches those keys to detect
     whether a jobs worker is available.

## Main Refactor Difference

### Before

- API owned both the HTTP request lifecycle and the practical worker lifecycle.
- Queue consumption and domain execution were conceptually co-located.
- Redis was present, but the boundaries between queueing, locking, state, and
  streaming were less explicit.

### After

- `apps/api` is the **control plane**:
  - creates tracked jobs
  - writes job state
  - exposes SSE status
  - executes domain logic through the internal executor
- `apps/jobs` is the **worker plane**:
  - consumes BullMQ queues
  - decrypts payloads
  - forwards execution requests to the API
  - publishes heartbeats
- Redis is the **shared coordination plane**:
  - queue transport
  - durable-ish job state
  - active-job dedupe
  - pub/sub for status events
  - worker heartbeat discovery

## Typical New Flow

````mermaid
sequenceDiagram
    participant C as Client
    participant API as apps/api
    participant JS as JobStateService
    participant JQ as JobQueueService
    participant R as Redis / BullMQ
    participant W as apps/jobs worker
    participant EX as /api/internal/jobs/execute
    participant D as Domain service

    C->>API: Start publish / grading / translation job
    API->>JS: createJob(...)
    JS->>R: Store job hash + optional active lock
    API->>JQ: enqueue(...)
    JQ->>R: Add encrypted BullMQ job
    API-->>C: Return jobId
    C->>API: Open SSE /jobs/:jobId/status-stream

    W->>R: Consume BullMQ job
    W->>W: decrypt payload
    W->>EX: POST /api/internal/jobs/execute
    EX->>D: run domain logic
    D->>JS: updateJobStatus(...)
    JS->>R: Update hash + publish job event
    R-->>API: Pub/Sub event
    API-->>C: SSE progress update
````
