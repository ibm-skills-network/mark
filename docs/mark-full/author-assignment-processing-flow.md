````mermaid
sequenceDiagram
    participant Client
    participant ApiGateway
    participant AssignmentController
    participant AssignmentService
    participant QuestionService
    participant LlmService
    participant PrismaService
    participant JobStatusService
    
    Client->>ApiGateway: Create/Update Assignment
    ApiGateway->>AssignmentController: Forward Request
    AssignmentController->>AssignmentService: Process Assignment
    
    alt Create Assignment
        AssignmentService->>PrismaService: Create Assignment Record
        PrismaService-->>AssignmentService: Assignment Created
    else Update Assignment
        AssignmentService->>PrismaService: Update Assignment Record
        PrismaService-->>AssignmentService: Assignment Updated
    end
    
    Client->>ApiGateway: Publish Assignment
    ApiGateway->>AssignmentController: Forward Request
    AssignmentController->>AssignmentService: publishAssignment()
    AssignmentService->>PrismaService: Create Job Record
    AssignmentService->>JobStatusService: Initialize Job Status
    
    alt Asynchronous Job Processing
        AssignmentService->>AssignmentService: processPublishingJob()
        
        par Process Questions
            AssignmentService->>PrismaService: Update/Create Questions
            PrismaService-->>AssignmentService: Questions Updated
        and Handle Translations
            AssignmentService->>LlmService: Translate Content
            LlmService-->>AssignmentService: Translations
            AssignmentService->>PrismaService: Store Translations
        end
        
        AssignmentService->>JobStatusService: Update Job Status
        JobStatusService-->>Client: SSE Progress Updates
    end
    
    AssignmentService-->>AssignmentController: Job ID
    AssignmentController-->>ApiGateway: Response with Job ID
    ApiGateway-->>Client: Job ID for Tracking
````