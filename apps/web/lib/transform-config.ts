import { TransformConfig } from "@/app/Helpers/data-transformer";

/**
 * Global configuration for data transformation
 */
export interface GlobalTransformConfig {
  enabled: boolean;
  apiConfig: TransformConfig;
  storageConfig: TransformConfig;
  formConfig: TransformConfig;
  debugMode: boolean;
  performanceLogging: boolean;
}

/**
 * Default configuration settings
 */
const DEFAULT_CONFIG: GlobalTransformConfig = {
  enabled: true,
  debugMode: process.env.NODE_ENV === "development",
  performanceLogging: process.env.NODE_ENV === "development",
  apiConfig: {
    fields: [
      "introduction",
      "instructions",
      "gradingCriteriaOverview",
      "question",
      "content",
    ],
    exclude: ["id", "createdAt", "updatedAt"],
    deep: true,
  },
  storageConfig: {
    fields: ["introduction", "instructions", "gradingCriteriaOverview"],
    deep: false,
    compressionLevel: "light",
  },
  formConfig: {
    exclude: ["id", "createdAt", "updatedAt", "userId"],
    deep: false,
  },
};

/**
 * Configuration manager for data transformation
 */
class TransformConfigManager {
  private config: GlobalTransformConfig = { ...DEFAULT_CONFIG };
  private listeners: ((config: GlobalTransformConfig) => void)[] = [];

  /**
   * Get current configuration
   */
  getConfig(): GlobalTransformConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<GlobalTransformConfig>): void {
    this.config = { ...this.config, ...updates };
    this.notifyListeners();
  }

  /**
   * Get configuration for specific use case
   */
  getAPIConfig(): TransformConfig {
    return this.config.apiConfig;
  }

  getStorageConfig(): TransformConfig {
    return this.config.storageConfig;
  }

  getFormConfig(): TransformConfig {
    return this.config.formConfig;
  }

  /**
   * Check if transformation is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugMode(): boolean {
    return this.config.debugMode;
  }

  /**
   * Check if performance logging is enabled
   */
  isPerformanceLoggingEnabled(): boolean {
    return this.config.performanceLogging;
  }

  /**
   * Subscribe to configuration changes
   */
  subscribe(listener: (config: GlobalTransformConfig) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners of configuration changes
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.config));
  }

  /**
   * Reset to default configuration
   */
  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.notifyListeners();
  }

  /**
   * Load configuration from environment variables
   */
  loadFromEnvironment(): void {
    const envConfig: Partial<GlobalTransformConfig> = {};

    if (process.env.NEXT_PUBLIC_TRANSFORM_ENABLED !== undefined) {
      envConfig.enabled = process.env.NEXT_PUBLIC_TRANSFORM_ENABLED === "true";
    }

    if (process.env.NEXT_PUBLIC_TRANSFORM_DEBUG !== undefined) {
      envConfig.debugMode = process.env.NEXT_PUBLIC_TRANSFORM_DEBUG === "true";
    }

    if (process.env.NEXT_PUBLIC_TRANSFORM_PERFORMANCE_LOGGING !== undefined) {
      envConfig.performanceLogging =
        process.env.NEXT_PUBLIC_TRANSFORM_PERFORMANCE_LOGGING === "true";
    }

    if (Object.keys(envConfig).length > 0) {
      this.updateConfig(envConfig);
    }
  }
}

/**
 * Global configuration instance
 */
export const transformConfig = new TransformConfigManager();

/**
 * Initialize configuration on module load
 */
if (typeof window !== "undefined") {
  transformConfig.loadFromEnvironment();
}
