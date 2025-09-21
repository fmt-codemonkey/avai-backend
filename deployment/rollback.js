#!/usr/bin/env node

/**
 * AVAI WebSocket Backend - Railway Deployment Rollback Script
 * 
 * Emergency rollback utility for Railway deployments.
 * Provides multiple rollback strategies and safety checks.
 * 
 * Usage:
 * - npm run rollback (interactive rollback)
 * - node deployment/rollback.js --commit <hash> (rollback to specific commit)
 * - node deployment/rollback.js --previous (rollback to previous deployment)
 * 
 * Features:
 * - Interactive rollback selection
 * - Git-based rollback
 * - Deployment history analysis
 * - Automatic verification after rollback
 * - Safety confirmations
 */

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const DeploymentVerifier = require('./verify');

class RollbackManager {
    constructor(options = {}) {
        this.options = {
            commit: options.commit || null,
            previous: options.previous || false,
            force: options.force || false,
            verify: options.verify !== false, // Default to true
            ...options
        };

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('🔄 Railway Deployment Rollback Manager');
        console.log(`📅 Started at: ${new Date().toISOString()}`);
        console.log();
    }

    /**
     * Main rollback orchestration
     */
    async rollback() {
        try {
            console.log('🔍 Analyzing current deployment...\n');
            
            // Get current deployment info
            const currentDeployment = await this.getCurrentDeployment();
            
            // Get rollback target
            const rollbackTarget = await this.selectRollbackTarget(currentDeployment);
            
            // Confirm rollback
            if (!this.options.force) {
                await this.confirmRollback(currentDeployment, rollbackTarget);
            }
            
            // Execute rollback
            await this.executeRollback(rollbackTarget);
            
            // Verify rollback
            if (this.options.verify) {
                await this.verifyRollback();
            }
            
            console.log('🎉 Rollback completed successfully!');
            return { success: true };

        } catch (error) {
            console.error('❌ Rollback failed:', error.message);
            throw error;
        } finally {
            this.rl.close();
        }
    }

    /**
     * Get current deployment information
     */
    async getCurrentDeployment() {
        console.log('📊 Gathering current deployment information...');
        
        const deployment = {
            url: null,
            commit: null,
            branch: null,
            status: null,
            timestamp: null
        };

        try {
            // Get Railway URL
            deployment.url = process.env.RAILWAY_STATIC_URL || await this.getRailwayUrl();
            console.log(`🌐 Current URL: ${deployment.url}`);

            // Get current git info
            deployment.commit = await this.executeCommand('git rev-parse HEAD');
            deployment.commit = deployment.commit.trim();
            console.log(`🔖 Current commit: ${deployment.commit.substring(0, 8)}`);

            deployment.branch = await this.executeCommand('git branch --show-current');
            deployment.branch = deployment.branch.trim();
            console.log(`📂 Current branch: ${deployment.branch}`);

            // Get Railway status
            try {
                const railwayStatus = await this.executeCommand('railway status --json');
                const status = JSON.parse(railwayStatus);
                deployment.status = status.status || status.state || 'unknown';
                console.log(`📈 Railway status: ${deployment.status}`);
            } catch (error) {
                console.warn('⚠️ Could not get Railway status');
                deployment.status = 'unknown';
            }

            // Check deployment history file
            try {
                const historyPath = path.join(process.cwd(), '.railway-deployment.json');
                const historyData = await fs.readFile(historyPath, 'utf8');
                const history = JSON.parse(historyData);
                deployment.timestamp = history.timestamp;
                deployment.version = history.version;
                console.log(`📅 Last deployment: ${deployment.timestamp}`);
            } catch (error) {
                console.warn('⚠️ No deployment history found');
            }

        } catch (error) {
            console.warn('⚠️ Some deployment info unavailable:', error.message);
        }

        return deployment;
    }

    /**
     * Select rollback target
     */
    async selectRollbackTarget(currentDeployment) {
        if (this.options.commit) {
            return {
                type: 'commit',
                target: this.options.commit,
                description: `Specific commit: ${this.options.commit.substring(0, 8)}`
            };
        }

        if (this.options.previous) {
            const previousCommit = await this.getPreviousCommit();
            return {
                type: 'commit',
                target: previousCommit,
                description: `Previous commit: ${previousCommit.substring(0, 8)}`
            };
        }

        // Interactive selection
        return await this.interactiveRollbackSelection();
    }

    /**
     * Interactive rollback target selection
     */
    async interactiveRollbackSelection() {
        console.log('\n📋 Available rollback options:\n');
        
        // Get recent commits
        const commitLog = await this.executeCommand('git log --oneline -10');
        const commits = commitLog.trim().split('\n');
        
        console.log('Recent commits:');
        commits.forEach((commit, index) => {
            console.log(`  ${index + 1}. ${commit}`);
        });
        
        console.log('\nRollback options:');
        console.log('  1. Previous commit (HEAD~1)');
        console.log('  2. Select specific commit from list above');
        console.log('  3. Enter custom commit hash');
        console.log('  4. Cancel rollback');
        
        const choice = await this.askQuestion('\nSelect rollback option (1-4): ');
        
        switch (choice.trim()) {
            case '1':
                const previousCommit = await this.getPreviousCommit();
                return {
                    type: 'commit',
                    target: previousCommit,
                    description: `Previous commit: ${previousCommit.substring(0, 8)}`
                };
                
            case '2':
                const commitIndex = await this.askQuestion('Enter commit number from list (1-10): ');
                const selectedCommit = commits[parseInt(commitIndex) - 1];
                if (!selectedCommit) {
                    throw new Error('Invalid commit selection');
                }
                const commitHash = selectedCommit.split(' ')[0];
                return {
                    type: 'commit',
                    target: commitHash,
                    description: `Selected commit: ${selectedCommit}`
                };
                
            case '3':
                const customCommit = await this.askQuestion('Enter commit hash: ');
                if (!customCommit.trim()) {
                    throw new Error('No commit hash provided');
                }
                return {
                    type: 'commit',
                    target: customCommit.trim(),
                    description: `Custom commit: ${customCommit.trim().substring(0, 8)}`
                };
                
            case '4':
                throw new Error('Rollback cancelled by user');
                
            default:
                throw new Error('Invalid selection');
        }
    }

    /**
     * Get previous commit hash
     */
    async getPreviousCommit() {
        const previousCommit = await this.executeCommand('git rev-parse HEAD~1');
        return previousCommit.trim();
    }

    /**
     * Confirm rollback with user
     */
    async confirmRollback(currentDeployment, rollbackTarget) {
        console.log('\n⚠️  ROLLBACK CONFIRMATION');
        console.log('═'.repeat(50));
        console.log(`Current commit: ${currentDeployment.commit?.substring(0, 8) || 'unknown'}`);
        console.log(`Rollback to: ${rollbackTarget.description}`);
        console.log(`Target URL: ${currentDeployment.url}`);
        console.log('═'.repeat(50));
        console.log();
        console.log('⚠️  This action will:');
        console.log('   1. Checkout the target commit');
        console.log('   2. Deploy to Railway');
        console.log('   3. Replace the current deployment');
        console.log('   4. May cause temporary service interruption');
        console.log();
        
        const confirmation = await this.askQuestion('Are you sure you want to proceed? (yes/no): ');
        
        if (confirmation.toLowerCase() !== 'yes') {
            throw new Error('Rollback cancelled by user');
        }
    }

    /**
     * Execute the rollback
     */
    async executeRollback(rollbackTarget) {
        console.log('🔄 Executing rollback...\n');
        
        try {
            // Stash any uncommitted changes
            console.log('💾 Stashing uncommitted changes...');
            try {
                await this.executeCommand('git stash push -m "Pre-rollback stash"');
                console.log('✅ Changes stashed');
            } catch (error) {
                console.log('ℹ️ No changes to stash');
            }

            // Checkout target commit
            console.log(`🔖 Checking out commit: ${rollbackTarget.target.substring(0, 8)}...`);
            await this.executeCommand(`git checkout ${rollbackTarget.target}`);
            console.log('✅ Commit checked out');

            // Verify target commit
            const currentCommit = await this.executeCommand('git rev-parse HEAD');
            if (currentCommit.trim() !== rollbackTarget.target) {
                throw new Error('Failed to checkout target commit');
            }

            // Deploy to Railway
            console.log('🚄 Deploying rollback to Railway...');
            await this.executeCommand('railway up --detach', { timeout: 300000 });
            console.log('✅ Rollback deployment initiated');

            // Wait for deployment
            console.log('⏳ Waiting for rollback deployment to complete...');
            await this.waitForDeployment();
            console.log('✅ Rollback deployment completed');

        } catch (error) {
            console.error('❌ Rollback execution failed:', error.message);
            
            // Attempt to restore original state
            console.log('🔄 Attempting to restore original state...');
            try {
                await this.executeCommand('git checkout -');
                console.log('✅ Original commit restored');
            } catch (restoreError) {
                console.error('❌ Failed to restore original state:', restoreError.message);
            }
            
            throw error;
        }
    }

    /**
     * Wait for Railway deployment to complete
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
                    return;
                }

                if (statusObj.status === 'FAILED' || statusObj.state === 'failed') {
                    throw new Error('Railway deployment failed');
                }
                
            } catch (error) {
                // Continue waiting if status check fails
            }

            console.log(`⏳ Deployment in progress... (${Math.round(elapsed/1000)}s elapsed)`);
            await this.sleep(interval);
            elapsed += interval;
        }

        throw new Error('Deployment timeout');
    }

    /**
     * Verify rollback success
     */
    async verifyRollback() {
        console.log('🔍 Verifying rollback...\n');
        
        try {
            // Wait for services to stabilize
            console.log('⏳ Waiting for services to initialize...');
            await this.sleep(30000);

            // Get deployment URL
            const url = process.env.RAILWAY_STATIC_URL || await this.getRailwayUrl();
            
            // Run verification tests
            const verifier = new DeploymentVerifier(url);
            const report = await verifier.runAllTests();

            if (!report.summary.success) {
                console.warn('⚠️ Some verification tests failed after rollback');
                console.warn('This may be expected depending on the rollback target');
            } else {
                console.log('✅ Rollback verification passed');
            }

            return report;

        } catch (error) {
            console.warn('⚠️ Rollback verification failed:', error.message);
            console.warn('The rollback may have succeeded, but verification could not be completed');
        }
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
            // Fallback to environment variable
        }

        return process.env.RAILWAY_STATIC_URL || 'https://your-app.railway.app';
    }

    /**
     * Execute shell command
     */
    async executeCommand(command, options = {}) {
        return new Promise((resolve, reject) => {
            const timeout = options.timeout || 30000;
            
            exec(command, { timeout }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Command failed: ${command}\n${error.message}`));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    /**
     * Ask user question
     */
    async askQuestion(question) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer);
            });
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
        commit: args.includes('--commit') ? args[args.indexOf('--commit') + 1] : null,
        previous: args.includes('--previous'),
        force: args.includes('--force'),
        verify: !args.includes('--no-verify')
    };

    const rollbackManager = new RollbackManager(options);
    
    rollbackManager.rollback().then(() => {
        console.log('\n🎉 Rollback process completed!');
        process.exit(0);
    }).catch((error) => {
        console.error('\n❌ Rollback process failed:', error.message);
        process.exit(1);
    });
}

module.exports = RollbackManager;