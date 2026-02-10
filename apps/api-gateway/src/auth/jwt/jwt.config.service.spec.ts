import { JwtConfigService } from "./jwt.config.service";

describe("JwtConfigService", () => {
  let service: JwtConfigService;
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.SECRET;
    process.env.SECRET = "test-secret-key";
    service = new JwtConfigService();
  });

  afterEach(() => {
    if (originalSecret) {
      process.env.SECRET = originalSecret;
    } else {
      delete process.env.SECRET;
    }
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should provide JWT constants", () => {
    expect(service.jwtConstants).toBeDefined();
    expect(service.jwtConstants.secret).toBeDefined();
    expect(service.jwtConstants.signOptions).toBeDefined();
  });

  it("should read SECRET from environment", () => {
    expect(service.jwtConstants.secret).toBe("test-secret-key");
  });

  it("should have expiration time in signOptions", () => {
    expect(service.jwtConstants.signOptions.expiresIn).toBe("6h");
  });

  it("should use default secret when SECRET is missing", () => {
    delete process.env.SECRET;
    const newService = new JwtConfigService();
    expect(newService.jwtConstants.secret).toBe("devsecret");
  });

  it("should handle empty SECRET by using default", () => {
    process.env.SECRET = "";
    const newService = new JwtConfigService();
    expect(newService.jwtConstants.secret).toBe("devsecret");
  });

  it("should handle very long SECRET", () => {
    const longSecret = "x".repeat(10_000);
    process.env.SECRET = longSecret;
    const newService = new JwtConfigService();
    expect(newService.jwtConstants.secret).toBe(longSecret);
  });

  it("should handle special characters in SECRET", () => {
    const specialSecret = "test!@#$%^&*()_+-=[]{}|;:',.<>?/";
    process.env.SECRET = specialSecret;
    const newService = new JwtConfigService();
    expect(newService.jwtConstants.secret).toBe(specialSecret);
  });

  it("should return same expiration time on multiple calls", () => {
    const expiration1 = service.jwtConstants.signOptions.expiresIn;
    const expiration2 = service.jwtConstants.signOptions.expiresIn;
    expect(expiration1).toBe(expiration2);
    expect(expiration1).toBe("6h");
  });

  it("should allow reading jwtConstants multiple times", () => {
    const constants1 = service.jwtConstants;
    const constants2 = service.jwtConstants;
    expect(constants1.secret).toBe(constants2.secret);
  });
});
