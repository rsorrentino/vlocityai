/**
 * Enterprise Integration Tests
 * Comprehensive integration tests for enterprise features
 */

const request = require('supertest');
const app = require('../../index');
const databaseService = require('../../services/databaseService');
const enterpriseMonitoringService = require('../../services/enterpriseMonitoringService');
const auditService = require('../../services/auditService');
const circuitBreakerService = require('../../services/circuitBreakerService');

describe('Enterprise Features Integration Tests', () => {
  let authToken;
  let testUser;

  beforeAll(async () => {
    // Setup test database
    await databaseService.initialize();

    // Create test user
    const authService = require('../../services/authService');
    testUser = await authService.createUser({
      username: 'enterprise_test_user',
      email: 'enterprise_test_user@test.com',
      password: 'TestPassword123!',
      firstName: 'Enterprise',
      lastName: 'Test',
      role: 'admin',
    });

    // Get auth cookie
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'enterprise_test_user',
        password: 'TestPassword123!',
      });

    // Extract the auth_token cookie for use in subsequent requests
    const cookies = loginResponse.headers['set-cookie'] || [];
    authToken = cookies.find(c => c.startsWith('auth_token='))?.split(';')[0]?.replace('auth_token=', '');
  });

  afterAll(async () => {
    // Cleanup
    await databaseService.close();
  });

  describe('Monitoring Service', () => {
    test('should record API metrics', async () => {
      const response = await request(app)
        .get('/api/system/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);

      // Check metrics
      const metrics = await enterpriseMonitoringService.getMetrics();
      expect(metrics).toContain('vlocity_enterprise_api_latency_seconds');
    });

    test('should create and finish traces', () => {
      const trace = enterpriseMonitoringService.startTrace('test_operation');
      expect(trace).toBeTruthy();
      expect(trace.traceId).toBeDefined();

      enterpriseMonitoringService.finishTrace(trace.traceId, 'ok');
      const finishedTrace = enterpriseMonitoringService.getTrace(trace.traceId);
      expect(finishedTrace.status).toBe('ok');
    });

    test('should record job metrics', () => {
      enterpriseMonitoringService.recordJob('export', 'success', 5000, 'test');
      enterpriseMonitoringService.recordJob('deploy', 'failed', 3000, 'test');

      // Metrics should be recorded (no error thrown)
      expect(true).toBe(true);
    });
  });

  describe('Audit Service', () => {
    test('should log authentication events', async () => {
      await auditService.logAuthentication({
        userId: testUser.id,
        username: testUser.username,
        action: 'login',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        requestId: 'test-request-id',
        sessionId: 'test-session-id',
        status: 'success',
      });

      // Flush batch
      await auditService.flushBatch();

      // Query audit logs
      const { logs } = await auditService.queryAuditLogs({
        action: 'auth_login',
        limit: 1,
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBe('auth_login');
    });

    test('should log data access events', async () => {
      await auditService.logDataAccess({
        userId: testUser.id,
        username: testUser.username,
        action: 'read',
        resourceType: 'job',
        resourceId: 'test-job-id',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        requestId: 'test-request-id',
        status: 'success',
      });

      await auditService.flushBatch();

      const { logs } = await auditService.queryAuditLogs({
        action: 'data_read',
        limit: 1,
      });

      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('Circuit Breaker Service', () => {
    test('should open circuit after failures', async () => {
      const circuitName = 'test_circuit';
      let failureCount = 0;

      // Simulate failures
      for (let i = 0; i < 6; i++) {
        try {
          await circuitBreakerService.execute(
            circuitName,
            async () => {
              failureCount++;
              throw new Error('Simulated failure');
            },
            { config: { failureThreshold: 5 } }
          );
        } catch (error) {
          // Expected
        }
      }

      const state = circuitBreakerService.getCircuitState(circuitName);
      expect(state.state).toBe('OPEN');
    });

    test('should throw CircuitBreakerOpenError when open', async () => {
      const circuitName = 'test_circuit_open';
      
      // Force open
      circuitBreakerService.forceOpen(circuitName);

      await expect(
        circuitBreakerService.execute(
          circuitName,
          async () => ({ success: true })
        )
      ).rejects.toThrow('Circuit breaker');
    });

    test('should reset circuit', () => {
      const circuitName = 'test_circuit_reset';
      circuitBreakerService.forceOpen(circuitName);
      
      const stateBefore = circuitBreakerService.getCircuitState(circuitName);
      expect(stateBefore.state).toBe('OPEN');

      circuitBreakerService.resetCircuit(circuitName);
      
      const stateAfter = circuitBreakerService.getCircuitState(circuitName);
      expect(stateAfter.state).toBe('CLOSED');
    });
  });

  describe('API Endpoints with Enterprise Features', () => {
    test('should include request ID in response', async () => {
      const response = await request(app)
        .get('/api/system/status')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Request-ID', 'test-request-id');

      expect(response.headers['x-request-id']).toBe('test-request-id');
    });

    test('should include correlation ID in response', async () => {
      const response = await request(app)
        .get('/api/system/status')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Correlation-ID', 'test-correlation-id');

      expect(response.headers['x-correlation-id']).toBe('test-correlation-id');
    });

    test('should enforce rate limiting', async () => {
      const requests = [];
      for (let i = 0; i < 150; i++) {
        requests.push(
          request(app)
            .get('/api/system/status')
            .set('Authorization', `Bearer ${authToken}`)
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      // Should have some rate limited responses
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Benchmarks', () => {
    test('should complete API call within SLA', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/system/status')
        .set('Authorization', `Bearer ${authToken}`);

      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(200); // 200ms SLA
    });

    test('should handle concurrent requests', async () => {
      const concurrentRequests = 50;
      const requests = Array(concurrentRequests).fill(null).map(() =>
        request(app)
          .get('/api/system/status')
          .set('Authorization', `Bearer ${authToken}`)
      );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;

      const successful = responses.filter(r => r.status === 200);
      expect(successful.length).toBe(concurrentRequests);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});

