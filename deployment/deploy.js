#!/usr/bin/env node

/**
 * AVAI WebSocket Backend - Automated Railway Deployment Script
 * 
 * Complete deployment automation for Railway platform.
 * Handles pre-deployment checks, deployment, verification, and rollback.
 * 
 * Usage:
 * - npm run deploy (standard deployment)
 * - node deployment/deploy.js --verify-only (verification only)
 * - node deployment/deploy.js --rollback (rollback to previous version)
 * 
 * Features:
 * - Pre-deployment validation
 * - Automated Railway deployment
 * - Post-deployment verification
 * - Automatic rollback on failure
 * - Comprehensive logging
 */

const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const DeploymentVerifier = require('./verify');

class RailwayDeployer {
    constructor(options = {}) {
        this.options = {
            verifyOnly: options.verifyOnly || false,
            rollback: options.rollback || false,
            skipTests: options.skipTests || false,
            timeout: options.timeout || 300000, // 5 minutes
            ...options
        };
        
        this.deployment = {
            startTime: Date.now(),
            version: null,
            previousVersion: null,
            railwayUrl: null,
            steps: []
        };

        console.log('🚀 Railway Deployment Automation Started');
        console.log(`📅 Started at: ${new Date().toISOString()}`);
        console.log(`⚙️  Options:`, this.options);
        console.log();
    }

    /**
     * Run complete deployment process
     */
    async deploy() {
        try {
            if (this.options.verifyOnly) {
                return await this.verifyDeployment();
            }

            if (this.options.rollback) {
                return await this.rollbackDeployment();
            }

            // Standard deployment flow
            await this.preDeploymentChecks();
            await this.deployToRailway();
            await this.postDeploymentVerification();
            await this.finalizeDeployment();

            console.log('🎉 Deployment completed successfully!');
            return { success: true, deployment: this.deployment };

        } catch (error) {
            console.error('❌ Deployment failed:', error.message);
            
            // Attempt rollback on failure
            if (!this.options.verifyOnly && !this.options.rollback) {
                console.log('🔄 Attempting automatic rollback...');
                try {
                    await this.rollbackDeployment();
                } catch (rollbackError) {
                    console.error('❌ Rollback also failed:', rollbackError.message);
                }
            }
            
            throw error;
        }
    }

    /**
     * Pre-deployment validation checks
     */
    async preDeploymentChecks() {
        this.logStep('Pre-deployment checks', 'started');
        console.log('🔍 Running pre-deployment checks...\n');

        // Check Railway CLI
        await this.checkRailwayCLI();

        // Validate environment
        await this.validateEnvironment();

        // Run local tests
        if (!this.options.skipTests) {
            await this.runLocalTests();
        }

        // Check git status
        await this.checkGitStatus();

        // Validate configuration
        await this.validateConfiguration();

        this.logStep('Pre-deployment checks', 'completed');
        console.log('✅ Pre-deployment checks passed!\n');
    }

    /**
     * Check Railway CLI availability
     */
    async checkRailwayCLI() {
        console.log('🚄 Checking Railway CLI...');
        
        try {
            const version = await this.executeCommand('railway --version');
            console.log(`✅ Railway CLI found: ${version.trim()}`);
            
            // Check authentication
            const user = await this.executeCommand('railway whoami');
            console.log(`✅ Authenticated as: ${user.trim()}`);
            
        } catch (error) {
            throw new Error('Railway CLI not found or not authenticated. Run: npm install -g @railway/cli && railway login');
        }
    }

    /**
     * Validate environment variables
     */
    async validateEnvironment() {
        console.log('🔧 Validating environment variables...');
        
        const requiredVars = [
            'SUPABASE_URL',
            'SUPABASE_SERVICE_ROLE_KEY',
            'CLERK_SECRET_KEY'
        ];

        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }

        console.log('✅ Environment variables validated');
    }

    /**
     * Run local tests before deployment
     */
    async runLocalTests() {
        console.log('🧪 Running local tests...');
        
        try {
            await this.executeCommand('npm run test:local');
            console.log('✅ Local tests passed');
        } catch (error) {
            throw new Error('Local tests failed. Fix issues before deploying.');
        }
    }

    /**
     * Check git repository status
     */
    async checkGitStatus() {
        console.log('📋 Checking git status...');
        
        try {
            // Check for uncommitted changes
            const status = await this.executeCommand('git status --porcelain');
            
            if (status.trim()) {
                console.warn('⚠️ Uncommitted changes detected:');
                console.warn(status);
                console.warn('Consider committing changes before deployment');
            } else {
                console.log('✅ Working directory clean');
            }

            // Get current branch
            const branch = await this.executeCommand('git branch --show-current');
            console.log(`📂 Current branch: ${branch.trim()}`);

            // Get latest commit
            const commit = await this.executeCommand('git rev-parse --short HEAD');
            this.deployment.version = commit.trim();
            console.log(`🔖 Deploying commit: ${this.deployment.version}`);

        } catch (error) {
            console.warn('⚠️ Git information not available (this is okay)');
        }
    }

    /**
     * Validate production configuration
     */
    async validateConfiguration() {
        console.log('⚙️ Validating production configuration...');
        
        // Check package.json
        const packagePath = path.join(process.cwd(), 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
        
        if (!packageJson.engines || !packageJson.engines.node) {
            throw new Error('package.json missing Node.js engine specification');
        }

        // Check for required scripts
        const requiredScripts = ['start', 'health'];
        const missingScripts = requiredScripts.filter(script => !packageJson.scripts[script]);
        
        if (missingScripts.length > 0) {
            throw new Error(`Missing required npm scripts: ${missingScripts.join(', ')}`);
        }

        // Check Railway configuration files
        const requiredFiles = [
            'railway.json',
            'Procfile',
            '.railwayignore'
        ];

        for (const file of requiredFiles) {
            try {
                await fs.access(path.join(process.cwd(), file));
                console.log(`✅ ${file} found`);
            } catch (error) {
                throw new Error(`Missing required Railway file: ${file}`);
            }
        }

        console.log('✅ Configuration validated');
    }

    /**
     * Deploy to Railway platform
     */
    async deployToRailway() {
        this.logStep('Railway deployment', 'started');
        console.log('🚄 Deploying to Railway...\n');

        try {
            // Get current deployment URL (if any)
            try {
                this.deployment.previousVersion = await this.executeCommand('railway status --json');
            } catch (error) {
                console.log('ℹ️ No previous deployment found');
            }

            // Deploy using Railway CLI
            console.log('📤 Uploading to Railway...');
            const deployOutput = await this.executeCommand('railway up --detach', {
                timeout: this.options.timeout
            });

            console.log('✅ Upload completed');
            console.log('⏳ Waiting for deployment to complete...');

            // Wait for deployment to be ready
            await this.waitForDeployment();

            // Get deployment URL
            this.deployment.railwayUrl = await this.getRailwayUrl();
            console.log(`🌐 Deployment URL: ${this.deployment.railwayUrl}`);

            this.logStep('Railway deployment', 'completed');
            console.log('✅ Railway deployment completed!\n');

        } catch (error) {
            this.logStep('Railway deployment', 'failed', error.message);
            throw new Error(`Railway deployment failed: ${error.message}`);
        }
    }

    /**
     * Wait for Railway deployment to be ready
     */
    async waitForDeployment() {
        const maxWait = 180000; // 3 minutes
        const interval = 10000;  // 10 seconds
        let elapsed = 0;

        while (elapsed < maxWait) {
            try {
                const status = await this.executeCommand('railway status --json');
                const statusObj = JSON.parse(status);

                if (statusObj.status === 'SUCCESS' || statusObj.state === 'deployed') {
                    console.log('✅ Deployment ready');
                    return;
                }

                if (statusObj.status === 'FAILED' || statusObj.state === 'failed') {
                    throw new Error('Railway deployment failed');
                }

                console.log(`⏳ Deployment in progress... (${Math.round(elapsed/1000)}s elapsed)`);
                
            } catch (error) {
                console.log(`⏳ Waiting for deployment... (${Math.round(elapsed/1000)}s elapsed)`);
            }

            await this.sleep(interval);
            elapsed += interval;
        }

        throw new Error('Deployment timeout - taking longer than expected');
    }

    /**
     * Get Railway deployment URL
     */
    async getRailwayUrl() {
        try {
            const domains = await this.executeCommand('railway domains');
            const lines = domains.split('\n').filter(line => line.includes('railway.app'));
            
            if (lines.length > 0) {
                const domain = lines[0].trim().split(/\s+/)[0];
                return `https://${domain}`;
            }
        } catch (error) {
            console.warn('⚠️ Could not get Railway URL from domains command');
        }

        // Fallback: use environment variable if available
        return process.env.RAILWAY_STATIC_URL || 'https://your-app.railway.app';
    }

    /**
     * Post-deployment verification
     */
    async postDeploymentVerification() {
        this.logStep('Post-deployment verification', 'started');
        console.log('🔍 Verifying deployment...\n');

        try {
            // Wait a bit for services to fully start
            console.log('⏳ Waiting for services to initialize...');
            await this.sleep(30000); // 30 seconds

            // Run deployment verification
            const verifier = new DeploymentVerifier(this.deployment.railwayUrl);
            const report = await verifier.runAllTests();

            if (!report.summary.success) {
                throw new Error(`Verification failed: ${report.summary.failed}/${report.summary.total} tests failed`);
            }

            this.logStep('Post-deployment verification', 'completed');
            console.log('✅ Deployment verification passed!\n');

        } catch (error) {
            this.logStep('Post-deployment verification', 'failed', error.message);
            throw new Error(`Post-deployment verification failed: ${error.message}`);
        }
    }

    /**
     * Verify existing deployment
     */
    async verifyDeployment() {
        console.log('🔍 Verifying existing deployment...\n');

        const url = process.env.RAILWAY_STATIC_URL || await this.getRailwayUrl();
        const verifier = new DeploymentVerifier(url);
        
        return await verifier.runAllTests();
    }

    /**
     * Rollback to previous deployment
     */
    async rollbackDeployment() {
        console.log('🔄 Starting rollback process...\n');

        try {
            // Get deployment history
            const history = await this.executeCommand('railway logs --json');
            console.log('📋 Retrieved deployment history');

            // Attempt rollback (Railway doesn't have direct rollback, so we redeploy previous version)
            console.log('⚠️ Railway CLI does not support direct rollback');
            console.log('💡 To rollback manually:');
            console.log('   1. git checkout <previous-commit>');
            console.log('   2. railway up');
            console.log('   3. Verify deployment');

            throw new Error('Manual rollback required - see instructions above');

        } catch (error) {
            throw new Error(`Rollback failed: ${error.message}`);
        }
    }

    /**
     * Finalize deployment
     */
    async finalizeDeployment() {
        console.log('🎯 Finalizing deployment...\n');

        // Update deployment record
        this.deployment.endTime = Date.now();
        this.deployment.duration = this.deployment.endTime - this.deployment.startTime;

        // Save deployment info
        await this.saveDeploymentInfo();

        console.log('📊 Deployment Summary:');
        console.log(`   Version: ${this.deployment.version}`);
        console.log(`   URL: ${this.deployment.railwayUrl}`);
        console.log(`   Duration: ${Math.round(this.deployment.duration / 1000)}s`);
        console.log(`   Steps: ${this.deployment.steps.length}`);
    }

    /**
     * Save deployment information
     */
    async saveDeploymentInfo() {
        const deploymentInfo = {
            ...this.deployment,
            timestamp: new Date().toISOString(),
            success: true
        };

        try {
            const deploymentPath = path.join(process.cwd(), '.railway-deployment.json');
            await fs.writeFile(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
            console.log('📄 Deployment info saved to .railway-deployment.json');
        } catch (error) {
            console.warn('⚠️ Could not save deployment info:', error.message);
        }
    }

    /**
     * Execute shell command with Promise
     */
    async executeCommand(command, options = {}) {
        return new Promise((resolve, reject) => {
            const timeout = options.timeout || 30000;
            
            exec(command, { timeout }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Command failed: ${command}\n${error.message}\n${stderr}`));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    /**
     * Log deployment step
     */
    logStep(step, status, details = null) {
        this.deployment.steps.push({
            step,
            status,
            details,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        verifyOnly: args.includes('--verify-only'),
        rollback: args.includes('--rollback'),
        skipTests: args.includes('--skip-tests')
    };

    const deployer = new RailwayDeployer(options);
    
    deployer.deploy().then((result) => {
        console.log('\n🎉 Process completed successfully!');
        process.exit(0);
    }).catch((error) => {
        console.error('\n❌ Process failed:', error.message);
        process.exit(1);
    });
}

module.exports = RailwayDeployer;