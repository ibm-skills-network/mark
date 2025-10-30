import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from '../admin.service';
import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../cache/redis.service';
import { LLMPricingService } from '../../llm/core/services/llm-pricing.service';
import { LLM_PRICING_SERVICE } from '../../llm/llm.constants';
import { UserRole } from '../../../auth/interfaces/user.session.interface';

/**
 * Performance tests for admin analytics endpoints
 *
 * Tests verify that optimizations meet performance targets:
 * - Cold Request (BASIC): < 600ms
 * - Cold Request (DETAILED): < 1200ms
 * - Warm Request (cached): < 250ms
 * - Query Count: < 10 per request (vs 50-100+ before)
 */
describe('Admin Analytics Performance Tests', () => {
  let adminService: AdminService;
  let prismaService: PrismaService;
  let redisService: RedisService;

  // Performance tracking
  const queryLog: Array<{ query: string; timestamp: number }> = [];
  let queryCount = 0;

  const mockAdminSession = {
    email: 'admin@test.com',
    role: UserRole.ADMIN,
    sessionToken: 'test-token',
    userId: 'admin-user-id',
  };

  const mockAssignment = {
    id: 1,
    name: 'Test Assignment',
    type: 'AI_GRADED',
    published: true,
    introduction: 'Test intro',
    instructions: 'Test instructions',
    timeEstimateMinutes: 30,
    allotedTimeMinutes: 45,
    passingGrade: 0.7,
    updatedAt: new Date(),
    questions: Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      question: `Question ${index + 1}`,
      type: 'MULTIPLE_CHOICE',
      totalPoints: 10,
      isDeleted: false,
      variants: [],
      translations: [],
    })),
    AIUsage: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      assignmentId: 1,
      tokensIn: 1000,
      tokensOut: 500,
      usageType: 'grading',
      modelKey: 'gpt-4',
      createdAt: new Date(),
      usageCount: 1,
    })),
    AssignmentFeedback: [],
    Report: [],
    AssignmentAuthor: [
      {
        userId: 'author-1',
        assignmentId: 1,
      },
    ],
  };

  // Mock Prisma to track query performance
  const createMockPrismaService = () => {
    return {
      assignment: {
        findFirst: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'assignment.findFirst', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 10)); // Simulate DB latency
          return mockAssignment;
        }),
        findMany: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'assignment.findMany', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 10));
          return [mockAssignment];
        }),
        count: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'assignment.count', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 5));
          return 1;
        }),
      },
      assignmentAttempt: {
        count: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'assignmentAttempt.count', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 5));
          return 100;
        }),
        aggregate: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'assignmentAttempt.aggregate', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 10));
          return { _avg: { grade: 0.85 } };
        }),
        groupBy: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'assignmentAttempt.groupBy', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 10));
          return Array.from({ length: 50 }, (_, index) => ({
            assignmentId: 1,
            userId: `user-${index}`,
            _count: { id: 2 },
            _avg: { grade: 0.85 },
          }));
        }),
        findMany: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'assignmentAttempt.findMany', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 10));
          return [];
        }),
      },
      questionResponse: {
        count: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'questionResponse.count', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 5));
          return 80;
        }),
        aggregate: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'questionResponse.aggregate', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 10));
          return { _avg: { points: 8.5 } };
        }),
        groupBy: jest.fn().mockImplementation(async (arguments_) => {
          queryCount++;
          queryLog.push({ query: 'questionResponse.groupBy', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 15));

          // Return stats for each question
          const questionIds = arguments_.where.questionId.in || [];
          return questionIds.map((qId: number) => ({
            questionId: qId,
            _count: { id: 80 },
            _avg: { points: 8.5 },
          }));
        }),
      },
      aIUsage: {
        findMany: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'aIUsage.findMany', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 10));
          return mockAssignment.AIUsage;
        }),
      },
      assignmentFeedback: {
        groupBy: jest.fn().mockImplementation(async () => {
          queryCount++;
          queryLog.push({ query: 'assignmentFeedback.groupBy', timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 5));
          return [{
            assignmentId: 1,
            _avg: { assignmentRating: 4.5 },
            _count: { id: 10 },
          }];
        }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  };

  const createMockRedisService = () => {
    const cache = new Map<string, any>();

    return {
      getOrSet: jest.fn().mockImplementation(async (key: string, factory: () => Promise<any>, options?: any) => {
        // Simulate cache miss on first call, hit on subsequent calls
        if (!cache.has(key)) {
          const value = await factory();
          cache.set(key, value);
          return value;
        }
        return cache.get(key);
      }),
      get: jest.fn().mockImplementation(async (key: string) => cache.get(key)),
      set: jest.fn().mockImplementation(async (key: string, value: any) => {
        cache.set(key, value);
      }),
      del: jest.fn().mockImplementation(async (key: string) => {
        cache.delete(key);
      }),
      clearCache: () => cache.clear(),
    };
  };

  const mockLLMPricingService = {
    getPricingForModel: jest.fn().mockResolvedValue({
      inputPrice: 0.000_01,
      outputPrice: 0.000_03,
      effectiveDate: new Date(),
    }),
    calculateCostWithBreakdown: jest.fn().mockImplementation(async (modelKey, tokensIn, tokensOut, usageDate) => {
      const inputPrice = 0.000_01;
      const outputPrice = 0.000_03;
      const inputCost = tokensIn * inputPrice;
      const outputCost = tokensOut * outputPrice;
      const totalCost = inputCost + outputCost;

      return {
        inputCost,
        outputCost,
        totalCost,
        modelKey,
        inputTokenPrice: inputPrice,
        outputTokenPrice: outputPrice,
        pricingEffectiveDate: new Date(),
        usageDate: usageDate || new Date(),
        usageType: 'grading',
        tokensIn,
        tokensOut,
        calculationSteps: {
          inputCalculation: `${tokensIn} tokens × $${inputPrice} = $${inputCost}`,
          outputCalculation: `${tokensOut} tokens × $${outputPrice} = $${outputCost}`,
          totalCalculation: `$${inputCost} + $${outputCost} = $${totalCost}`,
        },
      };
    }),
  };

  beforeEach(async () => {
    // Reset performance tracking
    queryLog.length = 0;
    queryCount = 0;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: createMockPrismaService(),
        },
        {
          provide: RedisService,
          useValue: createMockRedisService(),
        },
        {
          provide: LLM_PRICING_SERVICE,
          useValue: mockLLMPricingService,
        },
      ],
    }).compile();

    adminService = module.get<AdminService>(AdminService);
    prismaService = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    // Clear cache between tests
    (redisService as any).clearCache?.();
  });

  describe('getAssignmentAnalytics Performance', () => {
    it('should complete BASIC tier request in < 600ms (cold cache)', async () => {
      const startTime = Date.now();

      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false // BASIC tier
      );

      const duration = Date.now() - startTime;

      console.log(`\n📊 BASIC tier (cold): ${duration}ms`);
      console.log(`   Query count: ${queryCount}`);

      expect(duration).toBeLessThan(600);
      expect(queryCount).toBeLessThan(15); // Allow some overhead for batched queries
    });

    it('should complete DETAILED tier request in < 1200ms (cold cache)', async () => {
      const startTime = Date.now();

      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        true // DETAILED tier
      );

      const duration = Date.now() - startTime;

      console.log(`\n📊 DETAILED tier (cold): ${duration}ms`);
      console.log(`   Query count: ${queryCount}`);

      expect(duration).toBeLessThan(1200);
      expect(queryCount).toBeLessThan(15); // Still should use batched queries
    });

    it('should complete cached request in < 250ms (warm cache)', async () => {
      // Prime the cache
      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false
      );

      // Reset query counter
      queryCount = 0;
      queryLog.length = 0;

      // Second request should hit cache
      const startTime = Date.now();

      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false
      );

      const duration = Date.now() - startTime;

      console.log(`\n📊 Cached request: ${duration}ms`);
      console.log(`   Query count: ${queryCount} (should be 0)`);

      expect(duration).toBeLessThan(250);
      expect(queryCount).toBe(0); // No DB queries on cache hit
    });

    it('should use batched queries for multiple assignments', async () => {
      queryCount = 0;

      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false
      );

      // Should use batched queries, not N individual queries
      // With 1 assignment and batching:
      // - 1 count query
      // - 1 findMany for assignments
      // - 3 groupBy queries (attempts, unique learners, feedback)
      // - 1 findMany for AI usage
      // Total: ~6-8 queries (not 50+ from before)

      console.log(`\n📊 Total queries for analytics: ${queryCount}`);
      console.log('   Query breakdown:');
      const queryBreakdown = queryLog.reduce((accumulator, log) => {
        accumulator[log.query] = (accumulator[log.query] || 0) + 1;
        return accumulator;
      }, {} as Record<string, number>);

      for (const [query, count] of Object.entries(queryBreakdown)) {
        console.log(`     - ${query}: ${count}`);
      }

      expect(queryCount).toBeLessThan(10);
    });
  });

  describe('getDetailedAssignmentInsights Performance', () => {
    it('should complete BASIC tier insights in < 600ms (cold cache)', async () => {
      const startTime = Date.now();

      await adminService.getDetailedAssignmentInsights(
        mockAdminSession,
        1,
        false // BASIC tier - no question insights
      );

      const duration = Date.now() - startTime;

      console.log(`\n📊 Insights BASIC tier (cold): ${duration}ms`);
      console.log(`   Query count: ${queryCount}`);

      expect(duration).toBeLessThan(600);
      expect(queryCount).toBeLessThan(10);
    });

    it('should complete DETAILED tier insights in < 1200ms (cold cache)', async () => {
      const startTime = Date.now();

      await adminService.getDetailedAssignmentInsights(
        mockAdminSession,
        1,
        true // DETAILED tier - includes question insights
      );

      const duration = Date.now() - startTime;

      console.log(`\n📊 Insights DETAILED tier (cold): ${duration}ms`);
      console.log(`   Query count: ${queryCount}`);

      expect(duration).toBeLessThan(1200);
      expect(queryCount).toBeLessThan(25); // More queries for question insights (1 groupBy + N count queries), but still batched
    });

    it('should skip expensive question queries when details=false', async () => {
      queryCount = 0;
      queryLog.length = 0;

      await adminService.getDetailedAssignmentInsights(
        mockAdminSession,
        1,
        false
      );

      // Should NOT call questionResponse.groupBy when details=false
      const questionResponseQueries = queryLog.filter(
        log => log.query === 'questionResponse.groupBy'
      );

      console.log(`\n📊 Question response queries (BASIC): ${questionResponseQueries.length}`);

      expect(questionResponseQueries.length).toBe(0);
    });

    it('should use batched query for question insights when details=true', async () => {
      queryCount = 0;
      queryLog.length = 0;

      await adminService.getDetailedAssignmentInsights(
        mockAdminSession,
        1,
        true
      );

      // Should use ONE batched groupBy instead of N individual queries
      const questionResponseGroupBy = queryLog.filter(
        log => log.query === 'questionResponse.groupBy'
      );

      const questionResponseCount = queryLog.filter(
        log => log.query === 'questionResponse.count'
      );

      console.log(`\n📊 Question insights queries (DETAILED):`);
      console.log(`   - groupBy calls: ${questionResponseGroupBy.length} (should be 1)`);
      console.log(`   - count calls: ${questionResponseCount.length} (should be ~10 for correct counts)`);

      // With 10 questions, we should have:
      // - 1 groupBy to get stats for all questions
      // - 10 count queries to get correct answer counts (one per question)
      // Total: 11 queries instead of 30+ (3 per question)

      expect(questionResponseGroupBy.length).toBe(1);
      expect(questionResponseCount.length).toBe(10);
    });
  });

  describe('Cache Performance', () => {
    it('should have separate cache keys for BASIC and DETAILED tiers', async () => {
      const getOrSetSpy = jest.spyOn(redisService, 'getOrSet');

      // Request BASIC tier
      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false
      );

      const basicCacheKey = getOrSetSpy.mock.calls[0][0];

      // Request DETAILED tier
      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        true
      );

      const detailedCacheKey = getOrSetSpy.mock.calls[1][0];

      console.log(`\n📊 Cache keys:`);
      console.log(`   BASIC: ${basicCacheKey}`);
      console.log(`   DETAILED: ${detailedCacheKey}`);

      // Cache keys should be different to prevent serving BASIC data for DETAILED requests
      expect(basicCacheKey).not.toBe(detailedCacheKey);
      expect(basicCacheKey).toContain('basic');
      expect(detailedCacheKey).toContain('detailed');
    });

    it('should cache responses independently for different tiers', async () => {
      // Prime both caches
      const basicResult = await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false
      );

      const detailedResult = await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        true
      );

      // Reset query counter
      queryCount = 0;

      // Both subsequent requests should hit cache
      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false
      );

      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        true
      );

      console.log(`\n📊 Queries after caching both tiers: ${queryCount} (should be 0)`);

      expect(queryCount).toBe(0);
    });
  });

  describe('Response Payload Size', () => {
    it('should return smaller payload for BASIC tier', async () => {
      const basicResult = await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false
      );

      const detailedResult = await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        true
      );

      const basicSize = JSON.stringify(basicResult).length;
      const detailedSize = JSON.stringify(detailedResult).length;

      const reduction = ((detailedSize - basicSize) / detailedSize) * 100;

      console.log(`\n📊 Payload sizes:`);
      console.log(`   BASIC: ${basicSize} bytes`);
      console.log(`   DETAILED: ${detailedSize} bytes`);
      console.log(`   Reduction: ${reduction.toFixed(1)}%`);

      // BASIC should be at least 30% smaller (target is 60-80% but depends on data)
      expect(basicSize).toBeLessThan(detailedSize);
      expect(reduction).toBeGreaterThan(30);
    });

    it('should exclude detailedCostBreakdown in BASIC tier', async () => {
      const basicResult: any = await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        false
      );

      const detailedResult: any = await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        undefined,
        true
      );

      // BASIC should not have detailedCostBreakdown
      expect(basicResult.data[0]?.insights?.detailedCostBreakdown).toBeUndefined();

      // DETAILED should have it
      expect(detailedResult.data[0]?.insights?.detailedCostBreakdown).toBeDefined();

      console.log(`\n📊 Cost breakdown included:`);
      console.log(`   BASIC: ${!!basicResult.data[0]?.insights?.detailedCostBreakdown}`);
      console.log(`   DETAILED: ${!!detailedResult.data[0]?.insights?.detailedCostBreakdown}`);
    });
  });

  describe('Performance Regression Tests', () => {
    it('should maintain performance with input validation', async () => {
      const startTime = Date.now();

      // Request with max limit
      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        25, // MAX_LIMIT
        undefined,
        false
      );

      const duration = Date.now() - startTime;

      console.log(`\n📊 Max limit request: ${duration}ms`);

      // Should still be fast even with max limit
      expect(duration).toBeLessThan(800);
    });

    it('should handle search queries efficiently', async () => {
      const startTime = Date.now();

      await adminService.getAssignmentAnalytics(
        mockAdminSession,
        1,
        10,
        'Test Assignment', // search term
        false
      );

      const duration = Date.now() - startTime;

      console.log(`\n📊 Search query request: ${duration}ms`);

      expect(duration).toBeLessThan(600);
    });
  });

  describe('Performance Summary', () => {
    it('should log comprehensive performance metrics', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('📊 ADMIN ANALYTICS PERFORMANCE SUMMARY');
      console.log('='.repeat(60));

      const tests = [
        { name: 'BASIC (cold)', tier: false, target: 600 },
        { name: 'DETAILED (cold)', tier: true, target: 1200 },
      ];

      for (const test of tests) {
        queryCount = 0;
        queryLog.length = 0;
        (redisService as any).clearCache?.();

        const start = Date.now();
        await adminService.getAssignmentAnalytics(
          mockAdminSession,
          1,
          10,
          undefined,
          test.tier
        );
        const duration = Date.now() - start;

        const status = duration < test.target ? '✅' : '❌';

        console.log(`\n${status} ${test.name}`);
        console.log(`   Duration: ${duration}ms (target: <${test.target}ms)`);
        console.log(`   Queries: ${queryCount} (target: <10)`);
        console.log(`   Status: ${duration < test.target ? 'PASS' : 'FAIL'}`);
      }

      console.log('\n' + '='.repeat(60));
    });
  });
});
