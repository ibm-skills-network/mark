````mermaid
sequenceDiagram
    participant Client
    participant ApiGateway
    participant AttemptController
    participant AttemptService
    participant LlmService
    participant ImageGradingService
    participant AttemptStatusService
    participant PrismaService
    
    Client->>ApiGateway: Create Assignment Attempt
    ApiGateway->>AttemptController: Forward Request
    AttemptController->>AttemptService: createAssignmentAttempt()
    AttemptService->>PrismaService: Create Attempt Record
    AttemptService->>PrismaService: Store Question Variants
    PrismaService-->>AttemptService: Attempt Created
    AttemptService-->>AttemptController: Attempt ID
    AttemptController-->>ApiGateway: Response with Attempt ID
    ApiGateway-->>Client: Attempt ID
    
    Client->>ApiGateway: Get Attempt Questions
    ApiGateway->>AttemptController: Forward Request
    AttemptController->>AttemptService: getAttempt()
    AttemptService->>PrismaService: Fetch Attempt & Questions
    PrismaService-->>AttemptService: Attempt with Questions
    AttemptService-->>AttemptController: Attempt Data
    AttemptController-->>ApiGateway: Response with Attempt Data
    ApiGateway-->>Client: Attempt Data with Questions
    
    Client->>ApiGateway: Submit Assignment
    ApiGateway->>AttemptController: Forward Request
    AttemptController->>AttemptService: validateAttemptSubmission()
    AttemptController->>AttemptStatusService: Initialize Status Stream
    AttemptController->>AttemptService: processAttemptSubmissionAsync()
    AttemptController-->>ApiGateway: Initial Response (Processing)
    ApiGateway-->>Client: Processing Status & Stream URL
    
    par Asynchronous Processing
        AttemptService->>AttemptStatusService: Update Progress
        AttemptStatusService-->>Client: SSE Progress Updates
        
        loop For Each Question
            alt Text Question
                AttemptService->>LlmService: Grade Text Question
            else Image Question
                AttemptService->>ImageGradingService: Grade Image Question
            else File Upload Question
                AttemptService->>LlmService: Grade File Upload
            else URL Question
                AttemptService->>LlmService: Grade URL Content
            else Choice-based Question
                AttemptService->>AttemptService: Automated Grading
            end
            
            AttemptService->>PrismaService: Store Question Response
            AttemptService->>AttemptStatusService: Update Question Progress
        end
        
        AttemptService->>AttemptService: Calculate Final Grade
        AttemptService->>PrismaService: Update Attempt Record
        AttemptService->>AttemptStatusService: Mark Completed
    end
````