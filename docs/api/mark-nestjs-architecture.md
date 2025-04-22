````mermaid
flowchart TD
    subgraph RequestHandling[Request Handling]
        ApiController[API Controller]
        DynamicJwtBearerTokenAuthGuard[JWT Bearer Token Auth Guard]
        DynamicJwtCookieAuthGuard[JWT Cookie Auth Guard]
        LoggerMiddleware[Logger Middleware]
        UserSessionMiddleware[User Session Middleware]
        
        ApiController --> DynamicJwtBearerTokenAuthGuard
        ApiController --> DynamicJwtCookieAuthGuard
        ApiController --> LoggerMiddleware
        ApiController --> UserSessionMiddleware
    end
    
    subgraph CoreModules[Core Modules]
        AssignmentController[Assignment Controller]
        AssignmentService[Assignment Service]
        QuestionController[Question Controller]
        QuestionService[Question Service]
        AttemptController[Attempt Controller]
        AttemptService[Attempt Service]
        AttemptStatusService[Attempt Status Service]
        LlmService[LLM Service]
        JobStatusService[Job Status Service]
        ImageGradingLlmService[Image Grading LLM Service]
        FileService[File Service]
        
        AssignmentController --> AssignmentService
        AssignmentService --> LlmService
        AssignmentService --> JobStatusService
        AssignmentService --> PrismaService
        
        QuestionController --> QuestionService
        QuestionService --> LlmService
        QuestionService --> PrismaService
        
        AttemptController --> AttemptService
        AttemptController --> AttemptStatusService
        AttemptService --> LlmService
        AttemptService --> FileService
        AttemptService --> QuestionService
        AttemptService --> AssignmentService
        AttemptService --> PrismaService
        AttemptService --> ImageGradingLlmService
        AttemptService --> JobStatusService
    end
    
    subgraph Integrations[Integrations]
        GithubController[GitHub Controller]
        GithubService[GitHub Service]
        
        GithubController --> GithubService
        GithubService --> PrismaService
    end
    
    subgraph DatabaseLayer[Database Layer]
        PrismaService[Prisma Service]
    end
    
    subgraph ExternalAPIs[External APIs]
        OpenAIApi[OpenAI API]
        GitHubApi[GitHub API]
    end
    
    LlmService --> OpenAIApi
    ImageGradingLlmService --> OpenAIApi
    GithubService --> GitHubApi
    ````s