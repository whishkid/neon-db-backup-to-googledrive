import * as core from '@actions/core';
import { config } from 'dotenv';
import { NeonDiscoveryService } from './neon-discovery';
import { DatabaseBackupService } from './backup-service';
import { GoogleDriveService } from './google-drive-service';
import { GoogleDriveOAuthService } from './google-drive-oauth';

// Load environment variables from .env file (for local development)
config();

interface BackupConfiguration {
  neonApiKey: string;
  googleDriveCredentials?: string; // Service account credentials (optional)
  googleClientId?: string; // OAuth client ID (optional)
  googleClientSecret?: string; // OAuth client secret (optional)  
  googleRefreshToken?: string; // OAuth refresh token (optional)
  retentionDays: number;
  outputDir: string;
  cleanupOldBackups: boolean;
  cleanupRetentionDays: number;
}

/**
 * Main backup orchestrator
 */
export class NeonBackupOrchestrator {
  private config: BackupConfiguration;
  private discoveryService: NeonDiscoveryService;
  private backupService: DatabaseBackupService;
  private driveService: GoogleDriveService | GoogleDriveOAuthService;

  constructor(config: BackupConfiguration) {
    this.config = config;
    
    // Initialize services
    this.discoveryService = new NeonDiscoveryService(
      config.neonApiKey, 
      config.retentionDays
    );
    
    this.backupService = new DatabaseBackupService(config.outputDir);
    
    // Choose authentication method
    if (config.googleDriveCredentials) {
      // Use service account
      this.driveService = new GoogleDriveService({
        credentials: config.googleDriveCredentials,
        folderName: 'neonbackups'
      });
    } else if (config.googleClientId && config.googleClientSecret && config.googleRefreshToken) {
      // Use OAuth
      this.driveService = new GoogleDriveOAuthService({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        refreshToken: config.googleRefreshToken
      });
    } else {
      throw new Error('Either Google Service Account credentials or OAuth credentials must be provided');
    }
  }

  /**
   * Run the complete backup process
   */
  async runBackupProcess(): Promise<void> {
    console.log('🚀 Starting Neon Database Backup Process');
    console.log('================================================');
    
    try {
      // Step 1: Test connections
      console.log('\n📡 Testing connections...');
      await this.testConnections();
      
      // Step 2: Discover active resources
      console.log('\n🔍 Discovering active Neon resources...');
      const activeResources = await this.discoveryService.discoverActiveResources();
      
      if (activeResources.length === 0) {
        console.log('ℹ️  No active resources found. No backups needed.');
        return;
      }
      
      // Step 3: Create backups
      console.log(`\n💾 Creating backups for ${activeResources.length} resources...`);
      const backupResults = await this.backupService.createMultipleBackups(activeResources);
      
      const successfulBackups = backupResults.filter(r => r.success);
      if (successfulBackups.length === 0) {
        console.log('❌ No successful backups created. Stopping process.');
        throw new Error('No successful backups created');
      }
      
      // Step 4: Upload to Google Drive
      console.log('\n☁️  Uploading backups to Google Drive...');
      await this.driveService.initialize();
      const uploadResults = await this.driveService.uploadMultipleBackups(backupResults);
      
      // Step 5: Cleanup old backups (optional)
      if (this.config.cleanupOldBackups) {
        console.log('\n🧹 Cleaning up old backups...');
        await this.backupService.cleanupOldBackups(this.config.cleanupRetentionDays);
        await this.driveService.cleanupOldBackups(this.config.cleanupRetentionDays);
      }
      
      // Step 6: Generate summary
      this.generateSummary(activeResources, backupResults, uploadResults);
      
      console.log('\n✅ Backup process completed successfully!');
      
    } catch (error) {
      console.error('\n❌ Backup process failed:', error);
      throw error;
    }
  }

  /**
   * Test all service connections
   */
  private async testConnections(): Promise<void> {
    try {
      // Test Google Drive connection
      const driveTestResult = await this.driveService.testConnection();
      if (!driveTestResult) {
        throw new Error('Google Drive connection test failed');
      }
      
      // Test pg_dump availability
      const pgDumpAvailable = await this.backupService.checkPgDumpAvailability();
      if (!pgDumpAvailable) {
        console.log('⚠️  pg_dump not found. Install PostgreSQL client tools for local testing.');
        console.log('   Windows: Download from https://www.postgresql.org/download/windows/');
        console.log('   Or use: winget install PostgreSQL.PostgreSQL');
        console.log('   GitHub Actions will install this automatically.');
      }
      
      console.log('✅ All connection tests passed');
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      throw error;
    }
  }

  /**
   * Generate and display process summary
   */
  private generateSummary(
    activeResources: any[], 
    backupResults: any[], 
    uploadResults: any[] | { successful: number; failed: number }
  ): void {
    const successfulBackups = backupResults.filter(r => r.success).length;
    const failedBackups = backupResults.length - successfulBackups;
    
    // Handle different upload result formats
    let successfulUploads = 0;
    let failedUploads = 0;
    
    if (Array.isArray(uploadResults)) {
      // Service account format
      successfulUploads = uploadResults.filter(r => r.success).length;
      failedUploads = uploadResults.length - successfulUploads;
    } else {
      // OAuth format
      successfulUploads = uploadResults.successful;
      failedUploads = uploadResults.failed;
    }
    
    const totalBackupSize = backupResults
      .filter(r => r.success && r.fileSize)
      .reduce((total, r) => total + r.fileSize, 0);
    
    console.log('\n📊 BACKUP PROCESS SUMMARY');
    console.log('========================');
    console.log(`🔍 Resources discovered: ${activeResources.length}`);
    console.log(`💾 Successful backups: ${successfulBackups}`);
    console.log(`❌ Failed backups: ${failedBackups}`);
    console.log(`☁️  Successful uploads: ${successfulUploads}`);
    console.log(`❌ Failed uploads: ${failedUploads}`);
    console.log(`📦 Total backup size: ${this.formatFileSize(totalBackupSize)}`);
    console.log(`⏱️  Process completed at: ${new Date().toISOString()}`);
  }

  /**
   * Utility function to format file size
   */
  private formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Get configuration from environment variables or GitHub Actions inputs
    const config: BackupConfiguration = {
      neonApiKey: getInput('NEON_API_KEY', true),
      googleDriveCredentials: getInput('GOOGLE_DRIVE_CREDENTIALS', false),
      googleClientId: getInput('GOOGLE_CLIENT_ID', false),
      googleClientSecret: getInput('GOOGLE_CLIENT_SECRET', false),
      googleRefreshToken: getInput('GOOGLE_REFRESH_TOKEN', false),
      retentionDays: parseInt(getInput('BACKUP_RETENTION_DAYS', false) || '7'),
      outputDir: getInput('OUTPUT_DIR', false) || './backups',
      cleanupOldBackups: getInput('CLEANUP_OLD_BACKUPS', false) === 'true',
      cleanupRetentionDays: parseInt(getInput('CLEANUP_RETENTION_DAYS', false) || '30')
    };

    // Validate configuration
    if (!config.neonApiKey) {
      throw new Error('NEON_API_KEY is required');
    }
    
    // Check if either authentication method is provided
    const hasServiceAccount = !!config.googleDriveCredentials;
    const hasOAuth = !!(config.googleClientId && config.googleClientSecret && config.googleRefreshToken);
    
    if (!hasServiceAccount && !hasOAuth) {
      throw new Error('Either Google Service Account credentials or OAuth credentials (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN) must be provided');
    }

    // Run backup process
    const orchestrator = new NeonBackupOrchestrator(config);
    await orchestrator.runBackupProcess();

  } catch (error) {
    console.error('❌ Main process failed:', error);
    
    // Set GitHub Actions output if running in Actions environment
    if (process.env.GITHUB_ACTIONS) {
      core.setFailed(error instanceof Error ? error.message : String(error));
    }
    
    process.exit(1);
  }
}

/**
 * Get input from environment variables or GitHub Actions inputs
 */
function getInput(name: string, required: boolean = false): string {
  // Try GitHub Actions input first
  let value = '';
  
  if (process.env.GITHUB_ACTIONS) {
    try {
      value = core.getInput(name);
    } catch {
      // Fallback to environment variable
    }
  }
  
  // Fallback to environment variable
  if (!value) {
    value = process.env[name] || '';
  }
  
  if (required && !value) {
    throw new Error(`Required input '${name}' is not provided`);
  }
  
  return value;
}

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export default main;