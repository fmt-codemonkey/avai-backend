#!/usr/bin/env node

/**
 * AVAI WebSocket Backend - Railway Setup Script
 * 
 * Interactive setup script for Railway deployment configuration.
 * Guides users through environment variable setup and Railway configuration.
 * 
 * Usage: node setup.js
 * 
 * Features:
 * - Interactive environment variable setup
 * - Railway CLI installation check
 * - Project initialization
 * - Environment variable deployment
 * - Validation and testing
 */

const readline = require('readline');
const fs = require('fs').promises;
const { exec } = require('child_process');
const path = require('path');

class SetupWizard {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        this.config = {
            NODE_ENV: 'production',
            PORT: '8080',
            HOST: '0.0.0.0'
        };

        console.log('🚀 AVAI WebSocket Backend - Railway Setup Wizard');
        console.log('📋 This wizard will guide you through Railway deployment setup\n');
    }

    /**
     * Run the complete setup process
     */
    async runSetup() {
        try {
            console.log('🔍 Starting setup process...\n');
            
            await this.checkPrerequisites();
            await this.collectCredentials();
            await this.setupRailway();
            await this.deployVariables();
            await this.finalizeSetup();
            
            console.log('\n🎉 Setup completed successfully!');
            console.log('💡 You can now deploy with: npm run deploy\n');
            
        } catch (error) {
            console.error('\n❌ Setup failed:', error.message);
            console.log('💡 Check the DEPLOYMENT.md file for manual setup instructions');
        } finally {
            this.rl.close();
        }
    }

    /**
     * Check prerequisites
     */
    async checkPrerequisites() {
        console.log('🔧 Checking prerequisites...\n');
        
        // Check Node.js version
        const nodeVersion = process.version;
        console.log(`✅ Node.js version: ${nodeVersion}`);
        
        if (!nodeVersion.startsWith('v18') && !nodeVersion.startsWith('v19') && !nodeVersion.startsWith('v20') && !nodeVersion.startsWith('v21') && !nodeVersion.startsWith('v22')) {
            console.warn('⚠️ Node.js 18+ recommended for Railway deployment');
        }

        // Check Railway CLI
        try {
            const railwayVersion = await this.executeCommand('railway --version');
            console.log(`✅ Railway CLI: ${railwayVersion.trim()}`);
        } catch (error) {
            console.log('❌ Railway CLI not found');
            const install = await this.askQuestion('Install Railway CLI? (y/n): ');
            
            if (install.toLowerCase() === 'y') {
                console.log('📦 Installing Railway CLI...');
                await this.executeCommand('npm install -g @railway/cli');
                console.log('✅ Railway CLI installed');
            } else {
                throw new Error('Railway CLI is required for deployment');
            }
        }

        // Check Railway authentication
        try {
            const user = await this.executeCommand('railway whoami');
            console.log(`✅ Railway authenticated as: ${user.trim()}`);
        } catch (error) {
            console.log('❌ Railway not authenticated');
            console.log('🔐 Please run: railway login');
            
            const login = await this.askQuestion('Login to Railway now? (y/n): ');
            if (login.toLowerCase() === 'y') {
                await this.executeCommand('railway login');
                console.log('✅ Railway authentication completed');
            } else {
                throw new Error('Railway authentication is required');
            }
        }

        console.log('✅ Prerequisites check completed\n');
    }

    /**
     * Collect required credentials
     */
    async collectCredentials() {
        console.log('🔑 Collecting credentials...\n');
        
        // Supabase configuration
        console.log('📊 Supabase Configuration:');
        console.log('   Get these from: https://app.supabase.com/project/YOUR_PROJECT/settings/api');
        
        this.config.SUPABASE_URL = await this.askQuestion('Supabase URL: ');
        this.config.SUPABASE_SERVICE_ROLE_KEY = await this.askQuestion('Supabase Service Role Key: ');
        
        // Clerk configuration
        console.log('\n🔐 Clerk Configuration:');
        console.log('   Get these from: https://dashboard.clerk.com/');
        
        this.config.CLERK_SECRET_KEY = await this.askQuestion('Clerk Secret Key: ');
        
        // Optional AVAI Canister
        console.log('\n🤖 AVAI Canister (Optional):');
        const hasCanister = await this.askQuestion('Do you have an AVAI Canister URL? (y/n): ');
        
        if (hasCanister.toLowerCase() === 'y') {
            this.config.AVAI_CANISTER_WS_URL = await this.askQuestion('AVAI Canister WebSocket URL: ');
        }

        // Performance settings
        console.log('\n⚡ Performance Settings (Optional - press Enter for defaults):');
        
        const maxConnections = await this.askQuestion('Max Connections (default: 1000): ');
        if (maxConnections) this.config.MAX_CONNECTIONS = maxConnections;
        
        const logLevel = await this.askQuestion('Log Level (default: warn): ');
        if (logLevel) this.config.LOG_LEVEL = logLevel;

        console.log('\n✅ Credentials collected');
    }

    /**
     * Setup Railway project
     */
    async setupRailway() {
        console.log('\n🚄 Setting up Railway project...\n');
        
        // Check if already linked
        try {
            await this.executeCommand('railway status');
            console.log('✅ Already linked to Railway project');
            return;
        } catch (error) {
            // Not linked, need to initialize
        }

        console.log('🆕 No Railway project found. Setting up new project...');
        
        const setupOption = await this.askQuestion(
            'Choose setup option:\n' +
            '  1. Create new Railway project\n' +
            '  2. Link to existing project\n' +
            'Enter choice (1 or 2): '
        );

        if (setupOption === '1') {
            console.log('🆕 Creating new Railway project...');
            await this.executeCommand('railway init');
            console.log('✅ New Railway project created');
        } else if (setupOption === '2') {
            console.log('🔗 Available projects:');
            await this.executeCommand('railway connect');
            console.log('✅ Linked to existing project');
        } else {
            throw new Error('Invalid setup option selected');
        }
    }

    /**
     * Deploy environment variables to Railway
     */
    async deployVariables() {
        console.log('\n📤 Deploying environment variables to Railway...\n');
        
        const envVars = Object.entries(this.config);
        
        for (const [key, value] of envVars) {
            if (value) {
                console.log(`Setting ${key}...`);
                await this.executeCommand(`railway variables set ${key}="${value}"`);
            }
        }
        
        console.log('✅ Environment variables deployed to Railway');
        
        // Save local .env file
        const saveLocal = await this.askQuestion('\nSave .env file locally? (y/n): ');
        
        if (saveLocal.toLowerCase() === 'y') {
            await this.saveEnvFile();
            console.log('✅ Local .env file saved');
        }
    }

    /**
     * Finalize setup
     */
    async finalizeSetup() {
        console.log('\n🎯 Finalizing setup...\n');
        
        // Verify Railway configuration
        console.log('🔍 Verifying Railway configuration...');
        const railwayVars = await this.executeCommand('railway variables');
        console.log('✅ Railway variables verified');
        
        // Test local setup
        const testLocal = await this.askQuestion('Run local tests? (y/n): ');
        if (testLocal.toLowerCase() === 'y') {
            try {
                console.log('🧪 Running local tests...');
                await this.executeCommand('npm run test:local');
                console.log('✅ Local tests passed');
            } catch (error) {
                console.warn('⚠️ Local tests failed - this may be normal without database connection');
            }
        }
        
        // Option to deploy immediately
        const deployNow = await this.askQuestion('Deploy to Railway now? (y/n): ');
        if (deployNow.toLowerCase() === 'y') {
            try {
                console.log('🚀 Deploying to Railway...');
                await this.executeCommand('npm run deploy');
                console.log('✅ Deployment completed successfully');
            } catch (error) {
                console.error('❌ Deployment failed:', error.message);
                console.log('💡 You can deploy manually later with: npm run deploy');
            }
        }
    }

    /**
     * Save environment file locally
     */
    async saveEnvFile() {
        const envContent = Object.entries(this.config)
            .filter(([key, value]) => value)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        
        const fullEnvContent = `# AVAI WebSocket Backend - Environment Configuration
# Generated by setup wizard on ${new Date().toISOString()}
# 
# Production environment variables for Railway deployment
# DO NOT commit this file to version control

${envContent}

# Optional performance settings (uncomment to use)
# CACHE_L1_SIZE=2000
# CACHE_L2_SIZE=20000
# DB_POOL_MIN=8
# DB_POOL_MAX=25
# WS_COMPRESSION=true

# Optional monitoring settings
# METRICS_ENABLED=true
# ERROR_TRACKING_ENABLED=true
# HEALTH_CHECK_INTERVAL=30000
`;
        
        await fs.writeFile('.env', fullEnvContent);
    }

    /**
     * Execute shell command
     */
    async executeCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
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
                resolve(answer.trim());
            });
        });
    }
}

// Run setup wizard if called directly
if (require.main === module) {
    const wizard = new SetupWizard();
    wizard.runSetup();
}

module.exports = SetupWizard;