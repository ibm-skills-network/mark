/**
 * DatabaseCircuitBreakerService - Circuit Breaker Pattern Implementation
 *
 * Implements the Circuit Breaker pattern to prevent cascading failures
 * when the database becomes unavailable. The circuit breaker has three states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failure threshold exceeded, requests are blocked
 * - HALF_OPEN: Testing if the service has recovered
 *
 * This protects the system from repeatedly attempting failed database operations
 * and allows time for the database to recover.
 *
 * @module database/circuit-breaker
 */

import { Injectable, Logger } from "@nestjs/common";

/**
 * Represents the possible states of the circuit breaker
 */
export enum CircuitState {
  CLOSED = "CLOSED", // Normal operation
  OPEN = "OPEN", // Blocking requests
  HALF_OPEN = "HALF_OPEN", // Testing recovery
}

@Injectable()
export class DatabaseCircuitBreakerService {
  private readonly logger = new Logger(DatabaseCircuitBreakerService.name);
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: Date;

  // Configuration parameters
  private readonly failureThreshold = 5; // Failures before opening circuit
  private readonly successThreshold = 3; // Successes needed to close from half-open
  private readonly timeout = 60_000; // Time before attempting recovery (ms)

  /**
   * Executes an operation through the circuit breaker
   * Monitors success/failure and manages circuit state transitions
   *
   * @template T
   * @param {() => Promise<T>} operation - The async operation to execute
   * @throws {Error} When circuit is open or operation fails
   * @returns {Promise<T>} Result of the operation
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime.getTime() > this.timeout) {
        this.state = CircuitState.HALF_OPEN;
        this.logger.log("Circuit breaker transitioned to HALF_OPEN");
      } else {
        throw new Error(
          "Circuit breaker is OPEN - database operations blocked",
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handles successful operation execution
   * Updates counters and potentially transitions circuit state
   *
   * @private
   */
  private onSuccess(): void {
    this.failureCount = 0;

    // If in HALF_OPEN state, check if we can fully close the circuit
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        this.logger.log("Circuit breaker transitioned to CLOSED");
      }
    }
  }

  /**
   * Handles failed operation execution
   * Updates failure counters and potentially opens the circuit
   *
   * @private
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    // Check if failure threshold exceeded
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.logger.warn("Circuit breaker transitioned to OPEN");
    }

    this.successCount = 0;
  }

  /**
   * Gets the current state of the circuit breaker
   *
   * @returns {CircuitState} Current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Returns detailed statistics about the circuit breaker
   * Useful for monitoring and debugging
   *
   * @returns {Object} Circuit breaker statistics
   */
  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Manually resets the circuit breaker to CLOSED state
   * Should be used with caution, typically for manual intervention
   *
   * @returns {void}
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.logger.log("Circuit breaker manually reset");
  }
}
