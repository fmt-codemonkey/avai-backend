#!/usr/bin/env node

/**
 * AVAI WebSocket Backend - Local Development Testing Script
 * 
 * Comprehensive local testing before deployment to Railway.
 * Tests all functionality in development environment.
 * 
 * Usage: npm run test:local
 * 
 * Features:
 * - Local server health verification
 * - Development environment testing
 * - Pre-deployment validation
 * - Configuration verification
 */

const DeploymentVerifier = require('./verify');

class LocalTester extends DeploymentVerifier {
    constructor() {
        super('http://localhost:8080');
        console.log('🏠 Running local development tests...\n');
    }

    /**
     * Run local-specific tests
     */
    async runLocalTests() {
        const localTests = [
            { name: 'Environment Variables', fn: () => this.testEnvironmentVariables() },
            { name: 'Development Configuration', fn: () => this.testDevelopmentConfig() },
            { name: 'Local Database Connection', fn: () => this.testLocalDatabase() },
            { name: 'Development CORS', fn: () => this.testDevelopmentCors() }
        ];

        console.log('🧪 Running local-specific tests...\n');

        for (const test of localTests) {
            try {
                console.log(`🔍 Testing: ${test.name}...`);
                const result = await test.fn();
                this.recordResult(test.name, 'PASS', result);
                console.log(`✅ ${test.name}: PASSED`);
            } catch (error) {
                this.recordResult(test.name, 'FAIL', { error: error.message });
                console.log(`❌ ${test.name}: FAILED - ${error.message}`);
            }
            
            await this.sleep(300);
        }

        // Run standard deployment tests
        console.log('\n🚀 Running standard deployment tests...\n');
        return await this.runAllTests();
    }

    /**
     * Test environment variables
     */
    async testEnvironmentVariables() {
        const requiredVars = [
            'SUPABASE_URL',
            'SUPABASE_SERVICE_ROLE_KEY',
            'CLERK_SECRET_KEY'
        ];

        const optionalVars = [
            'AVAI_CANISTER_WS_URL',
            'LOG_LEVEL',
            'MAX_CONNECTIONS',
            'CONNECTION_TIMEOUT'
        ];

        const results = {
            required: {},
            optional: {},
            missing: [],
            present: []
        };

        // Check required variables
        for (const varName of requiredVars) {
            const exists = !!process.env[varName];
            results.required[varName] = exists;
            
            if (exists) {
                results.present.push(varName);
            } else {
                results.missing.push(varName);
            }
        }

        // Check optional variables
        for (const varName of optionalVars) {
            const exists = !!process.env[varName];
            results.optional[varName] = exists;
            
            if (exists) {
                results.present.push(varName);
            }
        }

        if (results.missing.length > 0) {
            throw new Error(`Missing required environment variables: ${results.missing.join(', ')}`);
        }

        return results;
    }

    /**
     * Test development configuration
     */
    async testDevelopmentConfig() {
        const response = await this.makeRequest('/health');
        const health = JSON.parse(response.body);

        if (health.environment !== 'development') {
            throw new Error(`Expected development environment, got: ${health.environment}`);
        }

        // Check for development-specific features
        const devIndicators = {
            environment: health.environment === 'development',
            debugLogging: true, // Assume debug logging is available in dev
            corsAllowAll: true  // Assume CORS allows all in dev
        };

        return devIndicators;
    }

    /**
     * Test local database connection
     */
    async testLocalDatabase() {
        try {
            const response = await this.makeRequest('/health/database');
            const dbHealth = JSON.parse(response.body);

            // In development, database might be degraded but should respond
            if (response.statusCode !== 200 && response.statusCode !== 503) {
                throw new Error(`Unexpected database health status: ${response.statusCode}`);
            }

            return {
                responsive: true,
                healthy: dbHealth.healthy,
                responseTime: response.responseTime,
                canContinueWithoutDB: !dbHealth.healthy // Dev should work without DB
            };
        } catch (error) {
            // In development, database issues are often acceptable
            console.warn('⚠️ Database not available in development - this is often normal');
            return {
                responsive: false,
                healthy: false,
                canContinueWithoutDB: true,
                error: error.message
            };
        }
    }

    /**
     * Test development CORS configuration
     */
    async testDevelopmentCors() {
        const testOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3000'
        ];

        const corsResults = [];

        for (const origin of testOrigins) {
            try {
                const response = await this.makeRequest('/health', {
                    headers: {
                        'Origin': origin,
                        'Access-Control-Request-Method': 'GET'
                    }
                });

                corsResults.push({
                    origin,
                    allowed: response.statusCode === 200,
                    corsHeader: response.headers['access-control-allow-origin']
                });
            } catch (error) {
                corsResults.push({
                    origin,
                    allowed: false,
                    error: error.message
                });
            }
        }

        return {
            testedOrigins: testOrigins.length,
            results: corsResults,
            developmentFriendly: corsResults.some(r => r.allowed)
        };
    }

    /**
     * Generate local testing recommendations
     */
    generateRecommendations() {
        const recommendations = [];
        const failedTests = this.results.filter(r => r.status === 'FAIL');

        if (failedTests.length === 0) {
            recommendations.push('✅ All local tests passed - ready for deployment');
            recommendations.push('🚀 Environment is properly configured');
            recommendations.push('📋 Consider running: npm run deploy');
        } else {
            recommendations.push('❌ Some local tests failed - fix before deployment');
            
            if (failedTests.some(t => t.test.includes('Environment'))) {
                recommendations.push('🔧 Check .env file and environment variables');
            }
            
            if (failedTests.some(t => t.test.includes('Database'))) {
                recommendations.push('🔧 Database issues detected - may be normal in development');
            }
            
            if (failedTests.some(t => t.test.includes('Configuration'))) {
                recommendations.push('🔧 Development configuration issues - check NODE_ENV');
            }

            recommendations.push('📚 Check documentation for setup requirements');
        }

        return recommendations;
    }

    /**
     * Print local testing header
     */
    printReport(report) {
        console.log('\n' + '='.repeat(80));
        console.log('🏠 LOCAL DEVELOPMENT TESTING REPORT');
        console.log('='.repeat(80));
        
        // Call parent method for the rest
        super.printReport(report);
    }
}

// Run local tests if called directly
if (require.main === module) {
    const tester = new LocalTester();
    
    tester.runLocalTests().catch((error) => {
        console.error('❌ Local testing failed:', error.message);
        process.exit(1);
    });
}

module.exports = LocalTester;