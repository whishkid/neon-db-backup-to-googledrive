import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { createReadStream, statSync } from 'fs';
import { join } from 'path';

export interface GoogleDriveOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class GoogleDriveOAuthService {
  private drive: any;
  private oauth2Client: OAuth2Client;
  private backupFolderId: string | null = null;

  constructor(private config: GoogleDriveOAuthConfig) {
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      'urn:ietf:wg:oauth:2.0:oob' // For installed applications
    );

    this.oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
    });

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  async initialize(): Promise<void> {
    console.log('🔗 Initializing Google Drive OAuth service...');
    
    try {
      // Test the connection
      await this.drive.about.get({ fields: 'user' });
      console.log('✅ Google Drive OAuth authentication successful');
      
      // Find or create the backup folder
      this.backupFolderId = await this.findOrCreateBackupFolder();
      console.log(`✅ Google Drive initialized. Backup folder ID: ${this.backupFolderId}`);
    } catch (error) {
      console.error('❌ Failed to initialize Google Drive OAuth service:', error);
      throw error;
    }
  }

  private async findOrCreateBackupFolder(): Promise<string> {
    try {
      // Search for existing neonbackups folder
      const response = await this.drive.files.list({
        q: "name='neonbackups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'files(id, name)',
      });

      if (response.data.files && response.data.files.length > 0) {
        console.log(`📁 Found existing folder 'neonbackups': ${response.data.files[0].id}`);
        return response.data.files[0].id;
      }

      // Create new folder
      console.log(`📁 Creating new folder 'neonbackups'...`);
      const folderResponse = await this.drive.files.create({
        resource: {
          name: 'neonbackups',
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });

      console.log(`✅ Created new folder 'neonbackups': ${folderResponse.data.id}`);
      return folderResponse.data.id;
    } catch (error) {
      console.error('❌ Failed to find or create backup folder:', error);
      throw error;
    }
  }

  async uploadBackup(filePath: string, originalName: string): Promise<any> {
    if (!this.backupFolderId) {
      throw new Error('Google Drive service not initialized');
    }

    console.log(`📤 Uploading backup file: ${originalName}...`);
    
    try {
      const fileStats = statSync(filePath);
      const fileSizeInMB = fileStats.size / (1024 * 1024);
      console.log(`📊 File size: ${fileSizeInMB.toFixed(2)} MB`);

      const response = await this.drive.files.create({
        resource: {
          name: originalName,
          parents: [this.backupFolderId],
        },
        media: {
          body: createReadStream(filePath),
        },
        fields: 'id, name, webViewLink, size',
      });

      console.log(`✅ Upload completed: ${response.data.name} (${response.data.id})`);
      return response.data;
    } catch (error) {
      console.error(`❌ Upload failed for ${originalName}:`, error);
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.drive.about.get({ fields: 'user' });
      return true;
    } catch (error) {
      console.error('❌ Google Drive OAuth connection test failed:', error);
      return false;
    }
  }

  async uploadMultipleBackups(backupResults: any[]): Promise<{ successful: number; failed: number }> {
    if (!this.backupFolderId) {
      throw new Error('Google Drive service not initialized');
    }

    console.log('🚀 Starting upload process for backup files...');
    
    const successfulBackups = backupResults.filter(r => r.success);
    console.log(`📤 Uploading ${successfulBackups.length} backup files to Google Drive...`);
    
    let successful = 0;
    let failed = 0;

    for (const backup of successfulBackups) {
      try {
        await this.uploadBackup(backup.filePath, backup.fileName);
        successful++;
      } catch (error) {
        console.error(`❌ Failed to upload ${backup.fileName}:`, error);
        failed++;
      }
    }

    console.log(`\n📊 Upload Summary:`);
    console.log(`   ✅ Successful uploads: ${successful}`);
    console.log(`   ❌ Failed uploads: ${failed}`);
    console.log(`   📁 Google Drive folder: neonbackups (${this.backupFolderId})`);

    return { successful, failed };
  }

  async cleanupOldBackups(daysToKeep: number = 30): Promise<void> {
    if (!this.backupFolderId) {
      throw new Error('Google Drive service not initialized');
    }

    console.log(`🧹 Cleaning up Google Drive backups older than ${daysToKeep} days...`);
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      const response = await this.drive.files.list({
        q: `'${this.backupFolderId}' in parents and trashed=false`,
        fields: 'files(id, name, createdTime)',
      });

      const oldFiles = response.data.files?.filter((file: any) => {
        const createdDate = new Date(file.createdTime);
        return createdDate < cutoffDate;
      }) || [];

      for (const file of oldFiles) {
        await this.drive.files.delete({ fileId: file.id });
        console.log(`🗑️ Deleted old backup: ${file.name}`);
      }

      console.log(`✅ Cleanup completed. Deleted ${oldFiles.length} old backup files from Google Drive.`);
    } catch (error) {
      console.error('❌ Failed to cleanup old backups:', error);
      throw error;
    }
  }
}