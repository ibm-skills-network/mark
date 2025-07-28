import { Injectable, Inject } from "@nestjs/common";
import { ILlmProvider } from "../interfaces/llm-provider.interface";
import { ALL_LLM_PROVIDERS } from "../../llm.constants";

@Injectable()
export class LlmRouter {
  private readonly map: Map<string, ILlmProvider>;

  constructor(@Inject(ALL_LLM_PROVIDERS) providers: ILlmProvider[]) {
    this.map = new Map(providers.map((p) => [p.key, p]));
  }

  /** Return provider by key, or throw if it doesn’t exist */
  get(key: string): ILlmProvider {
    const found = this.map.get(key);
    if (!found) throw new Error(`No LLM provider registered for key "${key}"`);
    return found;
  }

  /** Convenience default (first registered) */
  getDefault(): ILlmProvider {
    return this.map.values().next().value;
  }
}
