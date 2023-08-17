import * as fs from "node:fs";
import * as path from "node:path";
import { Controller, Get } from "@nestjs/common";
import { ApiService } from "./api.service";

@Controller({
  version: "1",
})
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get("info")
  rootV1() {
    return this.apiService.rootV1();
  }

  @Get("assets/example-schema")
  exampleSchema() {
    /* eslint-disable unicorn/prefer-module */
    const filePath = path.join(
      __dirname,
      "..",
      "assets",
      "schema",
      "assignment-example.json"
    );
    const fileContent = fs.readFileSync(filePath, "utf8");
    const formattedJson = JSON.stringify(JSON.parse(fileContent), undefined, 2);
    return `<pre>${formattedJson}</pre>`;
    /* eslint-enable unicorn/prefer-module */
  }
}
