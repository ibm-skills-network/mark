````mermaid
sequenceDiagram
    participant Client
    participant FrontendAPI as Frontend API Layer (talkToBackend.ts)
    participant Backend
    participant SSE as Server-Sent Events (SSE)
    
    %% Assignment Management Flow
    Client->>FrontendAPI: getAssignment(id)
    FrontendAPI->>Backend: GET /api/v1/assignments/:id
    Backend-->>FrontendAPI: Assignment Data
    FrontendAPI-->>Client: Assignment Object
    
    Client->>FrontendAPI: publishAssignment(id, data)
    FrontendAPI->>Backend: PUT /api/v1/assignments/:id/publish
    Backend-->>FrontendAPI: Job ID
    FrontendAPI-->>Client: Job ID
    
    %% SSE Job Status Tracking
    Client->>FrontendAPI: subscribeToJobStatus(jobId)
    FrontendAPI->>SSE: Connect to /assignments/jobs/:jobId/status-stream
    
    loop Until completion
        SSE-->>FrontendAPI: Status updates
        FrontendAPI-->>Client: onProgress callback
    end
    
    SSE-->>FrontendAPI: Final result
    FrontendAPI-->>Client: Completed notification
    
    %% Attempt Flow
    Client->>FrontendAPI: createAttempt(assignmentId)
    FrontendAPI->>Backend: POST /api/v1/assignments/:id/attempts
    Backend-->>FrontendAPI: Attempt ID
    FrontendAPI-->>Client: Attempt ID
    
    Client->>FrontendAPI: getAttempt(assignmentId, attemptId)
    FrontendAPI->>Backend: GET /api/v1/assignments/:id/attempts/:attemptId
    Backend-->>FrontendAPI: Attempt with Questions
    FrontendAPI-->>Client: Assignment Attempt Object
    
    Client->>FrontendAPI: submitAssignment(assignmentId, attemptId, responses)
    FrontendAPI->>Backend: PATCH /api/v1/assignments/:id/attempts/:attemptId
    Backend-->>FrontendAPI: Processing Status
    FrontendAPI-->>Client: Initial Processing Status
    
    %% SSE Attempt Status Tracking
    FrontendAPI->>SSE: Connect to /assignments/:id/attempts/:attemptId/status-stream
    
    loop Until completion
        SSE-->>FrontendAPI: Grading progress updates
        FrontendAPI-->>Client: onProgress callback
    end
    
    SSE-->>FrontendAPI: Final grading result
    FrontendAPI-->>Client: Graded assignment
````