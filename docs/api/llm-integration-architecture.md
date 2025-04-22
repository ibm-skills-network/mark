````mermaid
flowchart TD
    subgraph ApplicationCore[Application Core]
        AssignmentModule[Assignment Module]
        QuestionService[Question Service]
        AttemptService[Attempt Service]
    end
    
    subgraph LLMIntegration[LLM Integration]
        LlmService[LLM Service]
        LlmModule[LLM Module]
        ImageGradingService[Image Grading Service]
        Templates[Template Files]
        
        LlmService -->|Uses| Templates
        LlmModule -->|Provides| LlmService
        LlmService -->|Uses| ImageGradingService
        
        subgraph Models[Question Evaluation Models]
            TextModel[Text Question Model]
            ImageModel[Image Question Model]
            UrlModel[URL Question Model]
            FileModel[File Question Model]
            PresentationModel[Presentation Question Model]
            VideoModel[Video Question Model]
            
            LlmService -->|Uses| TextModel
            LlmService -->|Uses| ImageModel
            LlmService -->|Uses| UrlModel
            LlmService -->|Uses| FileModel
            LlmService -->|Uses| PresentationModel
            LlmService -->|Uses| VideoModel
        end
    end
    
    subgraph ExternalAPI[External LLM API]
        OpenAI[OpenAI API]
        CLD[Language Detection]
    end
    
    ApplicationCore -->|Depends on| LLMIntegration
    LLMIntegration -->|Calls| ExternalAPI
    
    subgraph LLMFunctions[LLM Functions]
        GenerateQuestions[Generate Questions]
        GenerateRubrics[Generate Rubrics]
        TranslateContent[Translate Content]
        GradeResponses[Grade Responses]
        ModerateContent[Moderate Content]
        ApplyGuardrails[Apply Guardrails]
        
        LlmService -->|Implements| GenerateQuestions
        LlmService -->|Implements| GenerateRubrics
        LlmService -->|Implements| TranslateContent
        LlmService -->|Implements| GradeResponses
        LlmService -->|Implements| ModerateContent
        LlmService -->|Implements| ApplyGuardrails
    end
````