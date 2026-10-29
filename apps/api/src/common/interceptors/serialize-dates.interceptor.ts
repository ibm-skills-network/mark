/* eslint-disable */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { isV3Route } from "../v3-scope";

@Injectable()
export class SerializeDatesInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (isV3Route(this.reflector, context)) {
      return next.handle();
    }
    return next.handle().pipe(map((data) => this.serializeDates(data)));
  }

  private serializeDates(object: any): any {
    if (object === null || object === undefined) {
      return object;
    }

    if (object instanceof Date) {
      return object.toISOString();
    }

    if (Array.isArray(object)) {
      return object.map((item) => this.serializeDates(item));
    }

    if (typeof object === "object") {
      const serialized: any = {};
      for (const key in object) {
        if (object.hasOwnProperty(key)) {
          serialized[key] = this.serializeDates(object[key]);
        }
      }
      return serialized;
    }

    return object;
  }
}
