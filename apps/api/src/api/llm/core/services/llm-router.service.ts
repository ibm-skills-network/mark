import { Inject, Injectable, Logger } from "@nestjs/common";
import { ALL_LLM_PROVIDERS, LLM_RESOLVER_SERVICE } from "../../llm.constants";
import { IMultimodalLlmProvider } from "../interfaces/llm-provider.interface";
import { LLMResolverService } from "./llm-resolver.service";

@Injectable()
export class LlmRouter {
  private readonly logger = new Logger(LlmRouter.name);
  private readonly map: Map<string, IMultimodalLlmProvider>;

  constructor(
    @Inject(ALL_LLM_PROVIDERS) providers: IMultimodalLlmProvider[],
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly resolverService: LLMResolverService,
  ) {
    this.map = new Map(providers.map((p) => [p.key, p]));
  }

  /** Return provider by key, or throw if it doesn't exist */
  get(key: string): IMultimodalLlmProvider {
    const found = this.map.get(key);
    if (!found) throw new Error(`No LLM provider registered for key "${key}"`);
    return found;
  }

  /** Get provider for a specific AI feature (uses dynamic assignment) */
  async getForFeature(featureKey: string): Promise<IMultimodalLlmProvider> {
    try {
      const assignedModelKey =
        await this.resolverService.resolveModelForFeature(featureKey);

      if (assignedModelKey) {
        const provider = this.map.get(assignedModelKey);
        if (provider) {
          this.logger.debug(
            `Using assigned model ${assignedModelKey} for feature ${featureKey}`,
          );
          return provider;
        } else {
          this.logger.warn(
            `Assigned model ${assignedModelKey} not found in providers, using default`,
          );
        }
      }

      const defaultProvider = this.getDefault();
      this.logger.debug(
        `Using default model ${defaultProvider.key} for feature ${featureKey}`,
      );
      return defaultProvider;
    } catch (error) {
      this.logger.error(
        `Failed to resolve model for feature ${featureKey}, using default:`,
        error,
      );
      return this.getDefault();
    }
  }

  /** Get provider with fallback model specification */
  async getForFeatureWithFallback(
    featureKey: string,
    fallbackModelKey = "gpt-4o-mini",
  ): Promise<IMultimodalLlmProvider> {
    try {
      const assignedModelKey =
        await this.resolverService.getModelKeyWithFallback(
          featureKey,
          fallbackModelKey,
        );
      return this.get(assignedModelKey);
    } catch (error) {
      this.logger.error(
        `Failed to get provider for feature ${featureKey} with fallback ${fallbackModelKey}:`,
        error,
      );
      return this.get(fallbackModelKey);
    }
  }

  /** Check if a specific model is available */
  hasModel(modelKey: string): boolean {
    return this.map.has(modelKey);
  }

  /** Get all available model keys */
  getAvailableModelKeys(): string[] {
    return [...this.map.keys()];
  }

  /** Convenience default (first registered) */
  getDefault(): IMultimodalLlmProvider {
    return this.map.values().next().value;
  }

  /** Get statistics about model usage */
  getProviderStats() {
    return {
      totalProviders: this.map.size,
      availableModels: [...this.map.keys()],
      defaultModel: this.getDefault()?.key || "none",
    };
  }
}
