import { Inject, Injectable, Optional } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  type GradingOutcome,
  type GradingQuestion,
  withLogContext,
} from "./contracts";
import { fetchUrlAsParts } from "./fetch-url";
import {
  createRenderer,
  type Renderer,
  rendererWithLogger,
} from "./formats/render";
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
  /** Shared so the binary lookup, warning and concurrency cap are per process. */
  private readonly renderer?: Renderer;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    @Optional()
    @Inject(V3_GRADING_MODEL_CLIENT)
    injectedClient?: GradingModelClient,
  ) {
    this.logger = parentLogger.child({ context: V3GradingService.name });
    this.client = injectedClient;
    this.renderer = createRenderer({ logger: this.logger });
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
    const requestLogger = withLogContext(this.logger, { ...context });
    const renderer = this.renderer
      ? rendererWithLogger(this.renderer, requestLogger)
      : undefined;
    const rendering = renderer ? { renderer } : {};
    return gradeSubmission(question, source, {
      client: this.getClient(),
      logger: this.logger,
      context,
      materializeDeps: {
        fetchUrl: (url) =>
          fetchUrlAsParts(url, undefined, this.logger, rendering),
        ...rendering,
      },
    });
  }
}
