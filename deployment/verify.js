#!/usr/bin/env node

/**
 * AVAI WebSocket Backend - Deployment Verification Script
 * 
 * Comprehensive deployment verification for Railway platform.
 * Tests all critical endpoints, health checks, and service functionality.
 * 
 * Usage:
 * - npm test (uses RAILWAY_STATIC_URL environment variable)
 * - node deployment/verify.js [URL]
 * 
 * Features:
 * - Health check verification
 * - WebSocket connection testing
 * - API endpoint validation
 * - Performance metrics collection
 * - Rollback recommendations
 */

const https = require('https');
const http = require('http');
const WebSocket = require('ws');

class DeploymentVerifier {
    constructor(baseUrl) {
        this.baseUrl = baseUrl || process.env.RAILWAY_STATIC_URL || 'http://localhost:8080';
        this.results = [];
        this.startTime = Date.now();
        
        console.log(`🚀 Starting deployment verification for: ${this.baseUrl}`);
        console.log(`📅 Verification started at: ${new Date().toISOString()}\n`);
    }

    /**
     * Run all verification tests
     */
    async runAllTests() {
        const tests = [
            { name: 'Basic Health Check', fn: () => this.testHealthCheck() },
            { name: 'Detailed Health Check', fn: () => this.testDetailedHealthCheck() },
            { name: 'Database Health Check', fn: () => this.testDatabaseHealth() },
            { name: 'Memory Health Check', fn: () => this.testMemoryHealth() },
            { name: 'Metrics Endpoint', fn: () => this.testMetricsEndpoint() },
            { name: 'WebSocket Connection', fn: () => this.testWebSocketConnection() },
            { name: 'WebSocket Authentication', fn: () => this.testWebSocketAuth() },
            { name: 'Error Handling', fn: () => this.testErrorHandling() },
            { name: 'Performance Benchmarks', fn: () => this.testPerformance() }
        ];

        for (const test of tests) {
            try {
                console.log(`🧪 Running: ${test.name}...`);
                const result = await test.fn();
                this.recordResult(test.name, 'PASS', result);
                console.log(`✅ ${test.name}: PASSED`);
            } catch (error) {
                this.recordResult(test.name, 'FAIL', { error: error.message });
                console.log(`❌ ${test.name}: FAILED - ${error.message}`);
            }
            
            // Small delay between tests
            await this.sleep(500);
        }

        return this.generateReport();
    }

    /**
     * Test basic health check endpoint
     */
    async testHealthCheck() {
        const response = await this.makeRequest('/health');
        
        if (response.statusCode !== 200) {
            throw new Error(`Health check returned status ${response.statusCode}`);
        }

        const health = JSON.parse(response.body);
        
        if (health.status !== 'healthy' && health.status !== 'degraded') {
            throw new Error(`Invalid health status: ${health.status}`);
        }

        // Verify required fields
        const requiredFields = ['timestamp', 'version', 'environment', 'uptime'];
        for (const field of requiredFields) {
            if (!health[field]) {
                throw new Error(`Missing required health field: ${field}`);
            }
        }

        return {
            status: health.status,
            uptime: health.uptime,
            environment: health.environment,
            responseTime: response.responseTime
        };
    }

    /**
     * Test detailed health check endpoint
     */
    async testDetailedHealthCheck() {
        const response = await this.makeRequest('/health/detailed');
        
        if (response.statusCode !== 200 && response.statusCode !== 503) {
            throw new Error(`Detailed health check returned unexpected status ${response.statusCode}`);
        }

        const health = JSON.parse(response.body);
        
        // Verify detailed health structure
        if (!health.services || typeof health.services !== 'object') {
            throw new Error('Missing or invalid services in detailed health check');
        }

        return {
            status: health.status,
            services: Object.keys(health.services),
            responseTime: response.responseTime
        };
    }

    /**
     * Test database health check
     */
    async testDatabaseHealth() {
        const response = await this.makeRequest('/health/database');
        
        // Accept both 200 and 503 for database health (might be degraded)
        if (response.statusCode !== 200 && response.statusCode !== 503) {
            throw new Error(`Database health check returned status ${response.statusCode}`);
        }

        const dbHealth = JSON.parse(response.body);
        
        if (!('healthy' in dbHealth)) {
            throw new Error('Database health check missing healthy status');
        }

        return {
            healthy: dbHealth.healthy,
            responseTime: response.responseTime,
            details: dbHealth.details || 'No details provided'
        };
    }

    /**
     * Test memory health check
     */
    async testMemoryHealth() {
        const response = await this.makeRequest('/health/memory');
        
        if (response.statusCode !== 200 && response.statusCode !== 503) {
            throw new Error(`Memory health check returned status ${response.statusCode}`);
        }

        const memHealth = JSON.parse(response.body);
        
        if (!('healthy' in memHealth)) {
            throw new Error('Memory health check missing healthy status');
        }

        return {
            healthy: memHealth.healthy,
            usage: memHealth.usage,
            responseTime: response.responseTime
        };
    }

    /**
     * Test metrics endpoint
     */
    async testMetricsEndpoint() {
        const response = await this.makeRequest('/metrics');
        
        if (response.statusCode !== 200) {
            throw new Error(`Metrics endpoint returned status ${response.statusCode}`);
        }

        const metrics = JSON.parse(response.body);
        
        // Verify metrics structure
        if (!metrics || typeof metrics !== 'object') {
            throw new Error('Invalid metrics response format');
        }

        return {
            metricsCount: Object.keys(metrics).length,
            responseTime: response.responseTime,
            hasSystemMetrics: 'system' in metrics,
            hasApplicationMetrics: 'application' in metrics
        };
    }

    /**
     * Test WebSocket connection
     */
    async testWebSocketConnection() {
        return new Promise((resolve, reject) => {
            const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws';
            const ws = new WebSocket(wsUrl);
            let connected = false;
            
            const timeout = setTimeout(() => {
                if (!connected) {
                    ws.close();
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 10000);

            ws.on('open', () => {
                connected = true;
                clearTimeout(timeout);
                
                // Send a test message
                ws.send(JSON.stringify({
                    type: 'heartbeat',
                    timestamp: Date.now()
                }));
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    ws.close();
                    resolve({
                        connected: true,
                        messageReceived: true,
                        messageType: message.type
                    });
                } catch (parseError) {
                    ws.close();
                    reject(new Error('Invalid WebSocket message format'));
                }
            });

            ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`WebSocket error: ${error.message}`));
            });

            ws.on('close', (code, reason) => {
                if (!connected) {
                    clearTimeout(timeout);
                    reject(new Error(`WebSocket closed before connection: ${code} ${reason}`));
                }
            });
        });
    }

    /**
     * Test WebSocket authentication flow
     */
    async testWebSocketAuth() {
        return new Promise((resolve, reject) => {
            const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws';
            const ws = new WebSocket(wsUrl);
            let authTested = false;
            
            const timeout = setTimeout(() => {
                if (!authTested) {
                    ws.close();
                    reject(new Error('WebSocket auth test timeout'));
                }
            }, 10000);

            ws.on('open', () => {
                // Send anonymous authentication
                ws.send(JSON.stringify({
                    type: 'authenticate',
                    anonymous: true
                }));
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    
                    if (message.type === 'auth_success' || message.type === 'auth_response') {
                        authTested = true;
                        clearTimeout(timeout);
                        ws.close();
                        resolve({
                            authSuccess: message.type === 'auth_success',
                            responseType: message.type,
                            anonymous: true
                        });
                    }
                } catch (parseError) {
                    clearTimeout(timeout);
                    ws.close();
                    reject(new Error('Invalid auth response format'));
                }
            });

            ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`WebSocket auth error: ${error.message}`));
            });
        });
    }

    /**
     * Test error handling
     */
    async testErrorHandling() {
        // Test non-existent endpoint
        const response = await this.makeRequest('/non-existent-endpoint');
        
        if (response.statusCode !== 404) {
            throw new Error(`Expected 404 for non-existent endpoint, got ${response.statusCode}`);
        }

        return {
            error404Handled: true,
            responseTime: response.responseTime
        };
    }

    /**
     * Test performance benchmarks
     */
    async testPerformance() {
        const performanceTests = [
            { name: 'Health Check Speed', endpoint: '/health', maxTime: 1000 },
            { name: 'Metrics Speed', endpoint: '/metrics', maxTime: 2000 },
            { name: 'Detailed Health Speed', endpoint: '/health/detailed', maxTime: 3000 }
        ];

        const results = {};

        for (const test of performanceTests) {
            const startTime = Date.now();
            const response = await this.makeRequest(test.endpoint);
            const responseTime = Date.now() - startTime;

            results[test.name] = {
                responseTime,
                passed: responseTime < test.maxTime,
                threshold: test.maxTime
            };

            if (responseTime >= test.maxTime) {
                console.warn(`⚠️ Performance warning: ${test.name} took ${responseTime}ms (threshold: ${test.maxTime}ms)`);
            }
        }

        return results;
    }

    /**
     * Make HTTP request with timing
     */
    async makeRequest(path, options = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const client = url.protocol === 'https:' ? https : http;
            const startTime = Date.now();

            const req = client.request(url, {
                method: options.method || 'GET',
                headers: options.headers || {},
                timeout: options.timeout || 10000
            }, (res) => {
                let body = '';
                
                res.on('data', (chunk) => {
                    body += chunk;
                });

                res.on('end', () => {
                    const responseTime = Date.now() - startTime;
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body,
                        responseTime
                    });
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                req.write(options.body);
            }

            req.end();
        });
    }

    /**
     * Record test result
     */
    recordResult(testName, status, details) {
        this.results.push({
            test: testName,
            status,
            details,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Generate comprehensive report
     */
    generateReport() {
        const totalTime = Date.now() - this.startTime;
        const passed = this.results.filter(r => r.status === 'PASS').length;
        const failed = this.results.filter(r => r.status === 'FAIL').length;
        const total = this.results.length;

        const report = {
            summary: {
                total,
                passed,
                failed,
                success: failed === 0,
                duration: totalTime,
                timestamp: new Date().toISOString(),
                url: this.baseUrl
            },
            tests: this.results,
            recommendations: this.generateRecommendations()
        };

        this.printReport(report);
        return report;
    }

    /**
     * Generate deployment recommendations
     */
    generateRecommendations() {
        const recommendations = [];
        const failedTests = this.results.filter(r => r.status === 'FAIL');

        if (failedTests.length === 0) {
            recommendations.push('✅ All tests passed - deployment is healthy');
            recommendations.push('🚀 Safe to proceed with production traffic');
        } else {
            recommendations.push('❌ Some tests failed - investigate before proceeding');
            
            if (failedTests.some(t => t.test.includes('Health Check'))) {
                recommendations.push('🔧 Health check issues detected - check server logs');
            }
            
            if (failedTests.some(t => t.test.includes('WebSocket'))) {
                recommendations.push('🔧 WebSocket issues detected - verify connection handling');
            }
            
            if (failedTests.some(t => t.test.includes('Database'))) {
                recommendations.push('🔧 Database issues detected - verify connection and credentials');
            }

            if (failedTests.length > 2) {
                recommendations.push('⚠️ Consider rollback - multiple critical failures');
            }
        }

        return recommendations;
    }

    /**
     * Print formatted report
     */
    printReport(report) {
        console.log('\n' + '='.repeat(80));
        console.log('📊 DEPLOYMENT VERIFICATION REPORT');
        console.log('='.repeat(80));
        
        console.log(`🎯 Target URL: ${report.summary.url}`);
        console.log(`⏱️  Duration: ${report.summary.duration}ms`);
        console.log(`📅 Completed: ${report.summary.timestamp}`);
        console.log();
        
        console.log(`📈 Results: ${report.summary.passed}/${report.summary.total} tests passed`);
        
        if (report.summary.success) {
            console.log('🎉 Status: SUCCESS - All tests passed!');
        } else {
            console.log('❌ Status: FAILURE - Some tests failed');
        }
        
        console.log();
        console.log('📋 Test Details:');
        console.log('-'.repeat(50));
        
        for (const test of report.tests) {
            const icon = test.status === 'PASS' ? '✅' : '❌';
            console.log(`${icon} ${test.test}: ${test.status}`);
            
            if (test.status === 'FAIL' && test.details.error) {
                console.log(`   Error: ${test.details.error}`);
            }
        }
        
        console.log();
        console.log('💡 Recommendations:');
        console.log('-'.repeat(50));
        
        for (const rec of report.recommendations) {
            console.log(rec);
        }
        
        console.log('\n' + '='.repeat(80));
        
        // Exit with appropriate code
        process.exit(report.summary.success ? 0 : 1);
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run verification if called directly
if (require.main === module) {
    const url = process.argv[2];
    const verifier = new DeploymentVerifier(url);
    
    verifier.runAllTests().catch((error) => {
        console.error('❌ Verification failed:', error.message);
        process.exit(1);
    });
}

module.exports = DeploymentVerifier;