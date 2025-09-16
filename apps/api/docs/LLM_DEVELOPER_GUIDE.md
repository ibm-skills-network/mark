# LLM Developer Guide: Adding New Models

## Overview

This guide walks you through the process of adding new LLM providers to the existing architecture. The system is designed to make this process straightforward while maintaining consistency and reliability.

## Table of Contents

1. [Quick Start Checklist](#quick-start-checklist)
2. [Step-by-Step Implementation](#step-by-step-implementation)
3. [Testing Your Implementation](#testing-your-implementation)
4. [Best Practices](#best-practices)
5. [Common Issues](#common-issues)

## Quick Start Checklist

Before you begin, ensure you have:

- [ ] Access to the new LLM provider's API
- [ ] API credentials and configuration details
- [ ] Understanding of the provider's pricing model
- [ ] Token counting methodology for the new provider

## Step-by-Step Implementation

### Step 1: Create the LLM Provider Service

Create a new service class that implements the `ILlmProvider` interface.

**Example: Adding Claude from Anthropic**

For a real-world example, see the [Llama-4-Maverick implementation](#llama-4-maverick-implementation-example) below.

```typescript
// src/api/llm/core/services/claude-llm.service.ts
import { HumanMessage } from "@langchain/core/messages";
import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { TOKEN_COUNTER } from "../../llm.constants";
import {
  ILlmProvider,
  LlmRequestOptions,
  LlmResponse,
} from "../interfaces/llm-provider.interface";
import { ITokenCounter } from "../interfaces/token-counter.interface";

@Injectable()
export class ClaudeLlmService implements ILlmProvider {
  private readonly logger: Logger;
  static readonly DEFAULT_MODEL = "claude-3-opus-20240229";
  readonly key = "claude-3-opus"; // This will be the model key in the database

  constructor(
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger
  ) {
    this.logger = parentLogger.child({ context: ClaudeLlmService.name });
  }

  async invoke(
    messages: HumanMessage[],
    options?: LlmRequestOptions
  ): Promise<LlmResponse> {
    try {
      // Initialize your LLM client (e.g., Anthropic SDK)
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      // Convert messages to provider format
      const content = messages
        .map((m) =>
          typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        )
        .join("\n");

      // Make the API call
      const response = await anthropic.messages.create({
        model: options?.modelName || ClaudeLlmService.DEFAULT_MODEL,
        max_tokens: options?.maxTokens || 4000,
        temperature: options?.temperature || 0.5,
        messages: [{ role: "user", content }],
      });

      // Count tokens (implement based on provider's methodology)
      const inputTokens = await this.tokenCounter.countTokens(
        content,
        this.key
      );
      const outputTokens = response.usage.output_tokens;

      return {
        content: response.content[0].text,
        tokenUsage: {
          input: inputTokens,
          output: outputTokens,
        },
      };
    } catch (error) {
      this.logger.error(`Claude API error: ${error.message}`);
      throw error;
    }
  }

  async invokeWithImage(
    textContent: string,
    imageData: string,
    options?: LlmRequestOptions
  ): Promise<LlmResponse> {
    // Implement image processing if supported by the provider
    // If not supported, throw an appropriate error
    throw new Error("Image processing not supported by Claude provider");
  }
}
```

### Step 2: Register the Provider in the Module

Update the LLM module to include your new provider.

```typescript
// src/api/llm/llm.module.ts
import { ClaudeLlmService } from "./core/services/claude-llm.service";

@Global()
@Module({
  providers: [
    // ... existing providers
    ClaudeLlmService,
    {
      provide: ALL_LLM_PROVIDERS,
      useFactory: (
        openai: OpenAiLlmService,
        openaiMini: OpenAiLlmMiniService,
        gpt4Vision: Gpt4VisionPreviewLlmService,
        claude: ClaudeLlmService // Add your provider here
      ) => {
        return [openai, openaiMini, gpt4Vision, claude];
      },
      inject: [
        OpenAiLlmService,
        OpenAiLlmMiniService,
        Gpt4VisionPreviewLlmService,
        ClaudeLlmService, // Add to injection list
      ],
    },
    // ... rest of providers
  ],
})
export class LlmModule {}
```

### Step 3: Add Model to Database

Create a migration to add the new model to the `LLMModel` table.

```bash
npx prisma migrate dev --name add_claude_model --create-only
```

```sql
-- migrations/TIMESTAMP_add_claude_model/migration.sql
INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt") VALUES
('claude-3-opus', 'Claude 3 Opus', 'Anthropic', true, NOW(), NOW())
ON CONFLICT ("modelKey") DO NOTHING;
```

### Step 4: Add Pricing Data

Add pricing information for the new model.

```sql
-- Add to the same migration or create a separate one
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "metadata", "createdAt", "updatedAt")
SELECT
  m.id,
  0.000015 as inputTokenPrice,    -- $15 per 1M input tokens
  0.000075 as outputTokenPrice,   -- $75 per 1M output tokens
  NOW() as effectiveDate,
  'MANUAL'::"PricingSource" as source,
  true as isActive,
  jsonb_build_object(
    'note', 'Initial Claude 3 Opus pricing',
    'source', 'Anthropic website',
    'lastUpdated', NOW()::text
  ) as metadata,
  NOW() as createdAt,
  NOW() as updatedAt
FROM "LLMModel" m
WHERE m."modelKey" = 'claude-3-opus';
```

### Step 5: Update Token Counter (if needed)

If your provider uses a different tokenization method, extend the token counter service.

```typescript
// src/api/llm/core/services/token-counter.service.ts
async countTokens(text: string, modelKey?: string): Promise<number> {
  switch (modelKey) {
    case 'claude-3-opus':
      // Implement Claude-specific token counting
      return this.countClaudeTokens(text);
    default:
      // Use existing OpenAI tokenization
      return this.countOpenAITokens(text);
  }
}

private countClaudeTokens(text: string): number {
  // Implement Anthropic's tokenization logic
  // You might need to use their SDK or estimation method
  return Math.ceil(text.length / 4); // Rough estimation
}
```

### Step 6: Apply Migration and Test

```bash
# Apply the migration
npx prisma migrate dev

# Regenerate Prisma client
npx prisma generate

# Test the new provider
npm run test -- --testNamePattern="Claude"
```

## Testing Your Implementation

### Unit Tests

Create comprehensive unit tests for your new provider.

```typescript
// src/api/llm/core/services/claude-llm.service.spec.ts
describe("ClaudeLlmService", () => {
  let service: ClaudeLlmService;
  let tokenCounter: ITokenCounter;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ClaudeLlmService,
        { provide: TOKEN_COUNTER, useValue: mockTokenCounter },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ClaudeLlmService>(ClaudeLlmService);
  });

  describe("invoke", () => {
    it("should successfully process a simple prompt", async () => {
      // Mock Anthropic API response
      const mockResponse = {
        content: [{ text: "Test response" }],
        usage: { output_tokens: 2 },
      };

      jest.spyOn(service, "invoke").mockResolvedValue({
        content: "Test response",
        tokenUsage: { input: 5, output: 2 },
      });

      const result = await service.invoke([new HumanMessage("Test prompt")]);

      expect(result.content).toBe("Test response");
      expect(result.tokenUsage.output).toBe(2);
    });

    it("should handle API errors gracefully", async () => {
      // Test error handling
    });
  });
});
```

### Integration Tests

Test the full flow with your new provider.

```typescript
// Integration test example
describe("LLM Integration with Claude", () => {
  it("should route requests to Claude when assigned", async () => {
    // 1. Assign Claude to a feature
    await assignmentService.assignModelToFeature(
      "text_grading",
      "claude-3-opus"
    );

    // 2. Make a request using the feature
    const response = await promptProcessor.processPromptForFeature(
      testPrompt,
      testAssignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      "text_grading"
    );

    // 3. Verify Claude was used and usage was tracked
    expect(response).toBeDefined();
    // Verify usage was tracked with correct model key
  });
});
```

## Best Practices

### 1. Error Handling

- Always wrap API calls in try-catch blocks
- Log errors with sufficient context
- Provide meaningful error messages
- Implement retries for transient failures

```typescript
async invoke(messages: HumanMessage[]): Promise<LlmResponse> {
  const maxRetries = 3;
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await this.makeApiCall(messages);
    } catch (error) {
      lastError = error;
      if (this.isRetryableError(error) && i < maxRetries - 1) {
        await this.sleep(Math.pow(2, i) * 1000); // Exponential backoff
        continue;
      }
      break;
    }
  }

  this.logger.error(`Failed after ${maxRetries} retries:`, lastError);
  throw lastError;
}
```

### 2. Configuration Management

- Use environment variables for API keys and configuration
- Support different models from the same provider
- Make timeout and retry settings configurable

```typescript
interface ClaudeConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  defaultModel?: string;
}

private getConfig(): ClaudeConfig {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    baseURL: process.env.ANTHROPIC_BASE_URL,
    timeout: parseInt(process.env.ANTHROPIC_TIMEOUT || '30000'),
    maxRetries: parseInt(process.env.ANTHROPIC_MAX_RETRIES || '3'),
    defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL || 'claude-3-opus-20240229',
  };
}
```

### 3. Token Counting Accuracy

- Use the provider's official tokenization method when available
- Implement accurate token counting for cost calculation
- Consider different tokenization for different models from the same provider

### 4. Rate Limiting

- Respect the provider's rate limits
- Implement client-side rate limiting if necessary
- Handle rate limit errors gracefully

```typescript
private rateLimiter = new RateLimiter({
  tokensPerInterval: 100,
  interval: 'minute'
});

async invoke(messages: HumanMessage[]): Promise<LlmResponse> {
  await this.rateLimiter.removeTokens(1);
  // ... rest of implementation
}
```

### 5. Monitoring and Logging

- Log all API calls with timing information
- Track success/failure rates
- Monitor token usage and costs
- Add health checks for the new provider

```typescript
async invoke(messages: HumanMessage[]): Promise<LlmResponse> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  this.logger.info(`Starting Claude request ${requestId}`);

  try {
    const response = await this.makeApiCall(messages);
    const duration = Date.now() - startTime;

    this.logger.info(`Claude request ${requestId} completed in ${duration}ms`);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    this.logger.error(`Claude request ${requestId} failed after ${duration}ms:`, error);
    throw error;
  }
}
```

## Common Issues

### Issue 1: Token Counting Mismatch

**Problem**: Inaccurate cost calculations due to wrong token counting.

**Solution**:

- Use the provider's official SDK for token counting
- If unavailable, implement estimation based on provider documentation
- Test token counting against known examples

### Issue 2: Provider-Specific Message Formats

**Problem**: Different providers expect different message formats.

**Solution**:

- Convert from the standard `HumanMessage` format to provider-specific format
- Handle system messages, images, and other content types appropriately
- Test with various message types

### Issue 3: Inconsistent Error Responses

**Problem**: Different error formats from different providers.

**Solution**:

- Standardize error handling in your provider implementation
- Map provider-specific errors to common error types
- Provide consistent error messages for the application

### Issue 4: Missing Environment Variables

**Problem**: Application fails when new provider credentials are missing.

**Solution**:

- Validate required environment variables at startup
- Provide clear error messages for missing configuration
- Consider making new providers optional during development

```typescript
@Injectable()
export class ClaudeLlmService implements ILlmProvider {
  constructor(...) {
    if (!process.env.ANTHROPIC_API_KEY) {
      this.logger.warn('ANTHROPIC_API_KEY not provided - Claude provider will be disabled');
    }
  }

  async invoke(...): Promise<LlmResponse> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Claude provider not configured - missing ANTHROPIC_API_KEY');
    }
    // ... implementation
  }
}
```

## Advanced Features

### Supporting Multiple Models from One Provider

```typescript
@Injectable()
export class ClaudeHaikuLlmService implements ILlmProvider {
  readonly key = "claude-3-haiku";
  static readonly DEFAULT_MODEL = "claude-3-haiku-20240307";
  // ... implementation differs only in model selection
}

// Add both to the module
{
  provide: ALL_LLM_PROVIDERS,
  useFactory: (..., claude: ClaudeLlmService, claudeHaiku: ClaudeHaikuLlmService) => {
    return [..., claude, claudeHaiku];
  },
  inject: [..., ClaudeLlmService, ClaudeHaikuLlmService],
}
```

### Adding Specialized Capabilities

```typescript
export interface IVisionLlmProvider extends ILlmProvider {
  analyzeImage(
    imageData: string,
    prompt?: string
  ): Promise<ImageAnalysisResponse>;
}

// Implement for vision-capable models
export class ClaudeVisionService implements IVisionLlmProvider {
  // ... implement both ILlmProvider and vision-specific methods
}
```

## Deployment Checklist

Before deploying your new LLM provider:

- [ ] All tests pass (unit and integration)
- [ ] Environment variables configured in all environments
- [ ] Database migrations applied
- [ ] Pricing data accurate and up-to-date
- [ ] Error handling and logging implemented
- [ ] Rate limiting configured
- [ ] Documentation updated
- [ ] Admin interface shows new model options
- [ ] Cost calculations verified with actual usage
- [ ] Provider credentials secured and rotated if needed

## Getting Help

If you encounter issues:

1. Check the existing provider implementations for patterns
2. Review the interface definitions for required methods
3. Ensure your provider follows the same patterns as existing ones
4. Test thoroughly with small requests before scaling up
5. Monitor logs and metrics after deployment

For questions or issues, refer to:

- LLM Architecture documentation
- Existing provider implementations
- Interface definitions in `/src/api/llm/core/interfaces/`
- Test examples in `/src/api/llm/core/services/*.spec.ts`

---

_This guide covers the standard process for adding new LLM providers. Each provider may have unique requirements - adapt the process as needed while maintaining consistency with the existing architecture._
