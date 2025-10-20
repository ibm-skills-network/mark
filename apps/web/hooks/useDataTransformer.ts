import { useCallback, useMemo } from "react";
import {
  DataTransformer,
  TransformConfig,
  smartEncode,
  smartDecode,
} from "@/app/Helpers/data-transformer";

export interface UseDataTransformerOptions {
  autoEncode?: boolean;
  autoDecode?: boolean;
  config?: TransformConfig;
  onError?: (error: Error) => void;
}

/**
 * React hook for automatic data transformation in API calls
 */
export function useDataTransformer(options: UseDataTransformerOptions = {}) {
  const { autoEncode = true, autoDecode = true, config, onError } = options;

  const encodeData = useCallback(
    (data: any, customConfig?: TransformConfig): any => {
      if (!autoEncode) return data;

      try {
        const finalConfig = { ...config, ...customConfig };
        const result = smartEncode(data, finalConfig);
        return result.data;
      } catch (error) {
        onError?.(error as Error);
        return data;
      }
    },
    [autoEncode, config, onError],
  );

  const decodeData = useCallback(
    (data: any, customConfig?: TransformConfig): any => {
      if (!autoDecode) return data;

      try {
        const finalConfig = { ...config, ...customConfig };
        return smartDecode(data, finalConfig);
      } catch (error) {
        onError?.(error as Error);
        return data;
      }
    },
    [autoDecode, config, onError],
  );

  const transformer = useMemo(
    () => ({
      encode: encodeData,
      decode: decodeData,
      encodeForAPI: (data: any) => DataTransformer.encodeForAPI(data).data,
      decodeFromAPI: (data: any) => DataTransformer.decodeFromAPI(data),
      encodeFormData: (data: any) => DataTransformer.encodeFormData(data).data,
      clearCache: DataTransformer.clearCache,
      getStats: DataTransformer.getStats,
    }),
    [encodeData, decodeData],
  );

  return transformer;
}

/**
 * Hook specifically for API operations with automatic request/response transformation
 */
export function useAPITransformer(config?: TransformConfig) {
  return useDataTransformer({
    autoEncode: true,
    autoDecode: true,
    config: {
      fields: [
        "introduction",
        "instructions",
        "gradingCriteriaOverview",
        "question",
        "content",
        "choice",
      ],
      deep: true,
      ...config,
    },
  });
}

/**
 * Hook for form data transformation
 */
export function useFormTransformer(config?: TransformConfig) {
  return useDataTransformer({
    autoEncode: true,
    autoDecode: true,
    config: {
      exclude: ["id", "createdAt", "updatedAt"],
      deep: false,
      ...config,
    },
  });
}
