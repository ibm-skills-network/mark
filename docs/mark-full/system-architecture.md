````mermaid
flowchart TD
    Client[Client Browser] <--> ApiGateway[API Gateway]
    
    subgraph Backend
        ApiGateway <--> ApiController[API Controller]
        ApiController <--> AuthModule[Auth Module]
        ApiController <--> AssignmentModule[Assignment Module]
        ApiController <--> AdminModule[Admin Module]
        ApiController <--> GithubModule[GitHub Module]
        AssignmentModule <--> LlmModule[LLM Module]
        AssignmentModule <--> JobModule[Job Module]
        LlmModule <--> ImageGradingService[Image Grading Service]
        LlmModule <--> OpenAI[OpenAI API]
        
        subgraph Database
            PrismaService[Prisma Service]
            DbAssignments[(Assignments)]
            DbQuestions[(Questions)]
            DbAttempts[(Attempts)]
            DbTranslations[(Translations)]
            DbUserCredentials[(User Credentials)]
            
            PrismaService --> DbAssignments
            PrismaService --> DbQuestions
            PrismaService --> DbAttempts
            PrismaService --> DbTranslations
            PrismaService --> DbUserCredentials
        end
        
        AssignmentModule <--> PrismaService
        AdminModule <--> PrismaService
        GithubModule <--> PrismaService
        AuthModule <--> PrismaService
    end
    
    subgraph ExternalServices
        OpenAI[OpenAI API]
        GitHub[GitHub API]
        LTIGateway[LTI Gateway]
    end
    
    GithubModule <--> GitHub
    ApiController <--> LTIGateway
    ````