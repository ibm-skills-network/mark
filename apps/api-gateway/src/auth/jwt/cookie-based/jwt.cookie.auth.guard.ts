import { ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { UserSessionRequest } from "../../interfaces/user.session.interface";
import {
  quizSessionContext,
  selectAuthenticationCookie,
} from "./jwt.cookie.extractor";
import {
  isStoreId,
  SAVED_SESSION_COOKIE,
  SavedSessionStore,
} from "./saved-session.store";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtCookieAuthGuard extends AuthGuard("cookie-strategy") {
  constructor(
    private reflector: Reflector,
    private savedSessions: SavedSessionStore,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return this.authenticate(context);
  }

  private async authenticate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const quiz = quizSessionContext(request.headers ?? {});
    const storeId: unknown = request.cookies?.[SAVED_SESSION_COOKIE];
    // A saved session is only ever selected alongside a current session.
    if (
      quiz &&
      isStoreId(storeId) &&
      selectAuthenticationCookie({
        headers: { cookie: request.headers?.cookie },
        cookies: request.cookies as Record<string, string> | undefined,
      }).token
    ) {
      request.savedSession = await this.savedSessions.find(
        storeId,
        quiz.role,
        quiz.assignmentId,
      );
    }
    return super.canActivate(context) as Promise<boolean>;
  }
}
