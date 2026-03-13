import { WatsonXAI } from "@ibm-cloud/watsonx-ai";
import { IamAuthenticator } from "ibm-cloud-sdk-core";

type ChatMessage = {
  content: unknown;
};

type ChatWatsonxOptions = {
  version: string;
  serviceUrl: string;
  projectId: string;
  watsonxAIAuthType?: string;
  watsonxAIApikey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
};

type WatsonXAIClient = InstanceType<typeof WatsonXAI>;

export class ChatWatsonx {
  private readonly client: WatsonXAIClient;
  private readonly projectId: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(options: ChatWatsonxOptions) {
    const apikey = options.watsonxAIApikey || ""; // pragma: allowlist secret
    const serviceUrl =
      options.serviceUrl || "https://us-south.ml.cloud.ibm.com"; // pragma: allowlist secret

    this.client = WatsonXAI.newInstance({
      version: options.version,
      serviceUrl,
      authenticator: new IamAuthenticator({ apikey }),
    });

    this.projectId = options.projectId;
    this.model = options.model;
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens ?? 2000;
  }

  async invoke(messages: ChatMessage[]): Promise<{ content: string }> {
    const input = messages
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      )
      .join("\n");

    const response = await this.client.generateText({
      modelId: this.model,
      projectId: this.projectId,
      input,
      parameters: {
        temperature: this.temperature,
        max_new_tokens: this.maxTokens,
      },
    });

    const content = response.result?.results?.[0]?.generated_text ?? "";
    return { content };
  }
}
