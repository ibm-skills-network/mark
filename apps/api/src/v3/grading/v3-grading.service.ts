import { Inject, Injectable, Optional } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import type { GradingOutcome, GradingQuestion } from "./contracts";
import { fetchUrlAsParts } from "./fetch-url";
import { gradeSubmission, type GradingLogContext } from "./grade-question";
import type { SubmissionSource } from "./materialize";
import {
  type GradingModelClient,
  OpenAiGradingModelClient,
} from "./model-client";

export const V3_GRADING_MODEL_CLIENT = Symbol("V3_GRADING_MODEL_CLIENT");

/** Nest face of the pure grader: wires the model client, logger and fetcher. */
@Injectable()
export class V3GradingService {
  private readonly logger: Logger;
  private client?: GradingModelClient;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    @Optional()
    @Inject(V3_GRADING_MODEL_CLIENT)
    injectedClient?: GradingModelClient,
  ) {
    this.logger = parentLogger.child({ context: V3GradingService.name });
    this.client = injectedClient;
  }

  /** Lazy so a pod without an OpenAI key still boots with v3 switched off. */
  private getClient(): GradingModelClient {
    this.client ??= new OpenAiGradingModelClient();
    return this.client;
  }

  grade(
    question: GradingQuestion,
    source: SubmissionSource,
    context: GradingLogContext,
  ): Promise<GradingOutcome> {
    return gradeSubmission(question, source, {
      client: this.getClient(),
      logger: this.logger,
      context,
      materializeDeps: {
        fetchUrl: (url) => fetchUrlAsParts(url, undefined, this.logger),
      },
    });
  }
}
