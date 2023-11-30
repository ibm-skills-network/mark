import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  // TODO: replace with some kind of front end (react? next.js?)
  root(): string {
    return "👋\n";
  }
}
