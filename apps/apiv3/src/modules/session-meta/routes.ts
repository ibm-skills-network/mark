import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../shared/config.js";
import { requirePrincipal } from "../access/plugin.js";
import { deriveLmsHost } from "./lms-host.js";

// Key order here is the wire order and must match the legacy API.
const userSession = z.object({
  userId: z.string(),
  role: z.enum(["learner", "author", "admin"]),
  assignmentId: z.number().nullable().optional(),
  returnUrl: z.string().nullable().optional(),
  launch_presentation_locale: z.string().nullable().optional(),
  lmsHost: z.string().optional(),
});

const aiStatus = z.object({
  grading: z.boolean(),
  chat: z.boolean(),
  authoring: z.boolean(),
});

type SessionMetaOptions = { aiFeatures: Config["aiFeatures"] };

export const sessionMetaRoutes: FastifyPluginAsync<SessionMetaOptions> = async (
  base,
  { aiFeatures },
) => {
  const app = base.withTypeProvider<ZodTypeProvider>();

  await app.register((scoped, _opts, done) => {
    requirePrincipal(scoped);
    scoped.withTypeProvider<ZodTypeProvider>().get(
      "/api/v1/user-session",
      {
        schema: { response: { 200: userSession } },
        config: { responseSchema: userSession },
      },
      (request) => {
        const { principal } = request;
        const { raw } = principal;
        const body: z.infer<typeof userSession> = {
          userId: principal.userId,
          role: principal.role,
        };
        if (typeof raw.assignmentId === "number" || raw.assignmentId === null) {
          body.assignmentId = raw.assignmentId;
        }
        for (const field of [
          "returnUrl",
          "launch_presentation_locale",
        ] as const) {
          const value = raw[field];
          if (typeof value === "string" || value === null) {
            body[field] = value;
          } else if (value !== undefined) {
            request.log.warn(
              { requestId: request.id, field },
              "session_meta.field_type_unexpected",
            );
          }
        }
        const lmsHost = deriveLmsHost(raw.lisOutcomeServiceUrl);
        if (lmsHost !== undefined) body.lmsHost = lmsHost;

        request.log.info(
          {
            requestId: request.id,
            userId: principal.userId,
            role: principal.role,
            assignmentId: principal.assignmentId,
          },
          "session_meta.user_session",
        );
        return body;
      },
    );
    done();
  });

  app.get(
    "/api/v1/ai-status",
    {
      schema: { response: { 200: aiStatus } },
      config: { responseSchema: aiStatus },
    },
    (request) => {
      const grading = !(aiFeatures.allDisabled || aiFeatures.gradingDisabled);
      const chat = !(aiFeatures.allDisabled || aiFeatures.chatDisabled);
      const authoring = !(
        aiFeatures.allDisabled || aiFeatures.authoringDisabled
      );
      request.log.info(
        { requestId: request.id, grading, chat, authoring },
        "session_meta.ai_status",
      );
      return { grading, chat, authoring };
    },
  );
};
