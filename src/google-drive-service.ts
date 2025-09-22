import { google, drive_v3 } from 'googleapis';
import { promises as fs } from 'fs';
import { basename } from 'path';
import { BackupResult } from './backup-service';

export interface GoogleDriveConfig {
  credentials: string; // JSON string of service account credentials
  parentFolderId?: string; // Optional parent folder ID
  folderName?: string; // Folder name to create/use (default: 'neonbackups')
}

export interface UploadResult {
  success: boolean;
  fileId?: string;
  fileName?: string;
  webViewLink?: string;
  error?: string;
  duration?: number;
}

export class GoogleDriveService {
  private drive: drive_v3.Drive;
  private parentFolderId?: string;
  private backupFolderId?: string;
  private folderName: string;

  constructor(config: GoogleDriveConfig) {
    // Parse credentials
    const credentials = JSON.parse(config.credentials);
    
    // Create JWT auth client
    const auth = new google.auth.JWT(
      credentials.client_email,
      undefined,
      credentials.private_key,
      ['https://www.googleapis.com/auth/drive.file']
    );

    // Create Drive API client
    this.drive = google.drive({ version: 'v3', auth });
    this.parentFolderId = config.parentFolderId;
    this.folderName = config.folderName || 'neonbackups';
  }

  /**
   * Initialize the Google Drive service and ensure backup folder exists
   */
  async initialize(): Promise<void> {
    try {
      console.log('🔗 Initializing Google Drive service...');
      
      // Find or create the backup folder
      this.backupFolderId = await this.findOrCreateFolder(this.folderName, this.parentFolderId);
      
      console.log(`✅ Google Drive initialized. Backup folder ID: ${this.backupFolderId}`);
    } catch (error) {
      console.error('❌ Error initializing Google Drive service:', error);
      throw error;
    }
  }

  /**
   * Find a folder by name, or create it if it doesn't exist
   */
  private async findOrCreateFolder(folderName: string, parentId?: string): Promise<string> {
    try {
      // Search for existing folder
      const query = parentId 
        ? `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
        : `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

      const searchResponse = await this.drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive'
      });

      if (searchResponse.data.files && searchResponse.data.files.length > 0) {
        const folderId = searchResponse.data.files[0].id!;
        console.log(`📁 Found existing folder '${folderName}': ${folderId}`);
        return folderId;
      }

      // Create new folder if not found
      console.log(`📁 Creating new folder '${folderName}'...`);
      
      const folderMetadata: drive_v3.Schema$File = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined
      };

      const createResponse = await this.drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });

      const folderId = createResponse.data.id!;
      console.log(`✅ Created new folder '${folderName}': ${folderId}`);
      return folderId;

    } catch (error) {
      console.error(`❌ Error finding/creating folder '${folderName}':`, error);
      throw error;
    }
  }

  /**
   * Upload a backup file to Google Drive
   */
  async uploadBackup(filePath: string, fileName?: string): Promise<UploadResult> {
    const startTime = Date.now();
    
    if (!this.backupFolderId) {
      return {
        success: false,
        error: 'Google Drive service not initialized. Call initialize() first.'
      };
    }

    const actualFileName = fileName || basename(filePath);
    console.log(`📤 Uploading backup file: ${actualFileName}...`);

    try {
      // Check if file exists
      await fs.access(filePath);
      
      // Get file stats
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      
      console.log(`📊 File size: ${this.formatFileSize(fileSize)}`);

      // Create file metadata
      const fileMetadata: drive_v3.Schema$File = {
        name: actualFileName,
        parents: [this.backupFolderId],
        description: `Neon database backup created on ${new Date().toISOString()}`
      };

      // Create read stream
      const media = {
        mimeType: 'application/octet-stream',
        body: require('fs').createReadStream(filePath)
      };

      // Upload file
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, size'
      });

      const duration = Date.now() - startTime;
      const fileId = response.data.id!;
      const webViewLink = response.data.webViewLink;

      console.log(`✅ Upload completed: ${actualFileName} (ID: ${fileId}) in ${duration}ms`);

      return {
        success: true,
        fileId,
        fileName: actualFileName,
        webViewLink: webViewLink || undefined,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Upload failed for ${actualFileName}:`, error);
      
      return {
        success: false,
        fileName: actualFileName,
        error: error instanceof Error ? error.message : String(error),
        duration
      };
    }
  }

  /**
   * Upload multiple backup files
   */
  async uploadMultipleBackups(backupResults: BackupResult[]): Promise<UploadResult[]> {
    console.log(`🚀 Starting upload process for backup files...`);
    
    if (!this.backupFolderId) {
      await this.initialize();
    }

    const uploadResults: UploadResult[] = [];
    const successfulBackups = backupResults.filter(result => result.success && result.filePath);

    console.log(`📤 Uploading ${successfulBackups.length} backup files to Google Drive...`);

    for (const backup of successfulBackups) {
      if (!backup.filePath) {
        uploadResults.push({
          success: false,
          fileName: backup.fileName,
          error: 'No file path provided'
        });
        continue;
      }

      try {
        const result = await this.uploadBackup(backup.filePath, backup.fileName);
        uploadResults.push(result);
        
        // Add a small delay between uploads to avoid rate limiting
        await this.sleep(500);
      } catch (error) {
        console.error(`❌ Unexpected error uploading ${backup.fileName}:`, error);
        uploadResults.push({
          success: false,
          fileName: backup.fileName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const successCount = uploadResults.filter(r => r.success).length;
    const failureCount = uploadResults.length - successCount;
    
    console.log(`\n📊 Upload Summary:`);
    console.log(`   ✅ Successful uploads: ${successCount}`);
    console.log(`   ❌ Failed uploads: ${failureCount}`);
    console.log(`   📁 Google Drive folder: ${this.folderName} (${this.backupFolderId})`);

    return uploadResults;
  }

  /**
   * List backup files in the Google Drive folder
   */
  async listBackupFiles(maxResults: number = 100): Promise<drive_v3.Schema$File[]> {
    if (!this.backupFolderId) {
      await this.initialize();
    }

    try {
      console.log('📋 Listing backup files in Google Drive...');
      
      const response = await this.drive.files.list({
        q: `'${this.backupFolderId}' in parents and trashed=false`,
        fields: 'files(id, name, size, createdTime, modifiedTime, webViewLink)',
        orderBy: 'createdTime desc',
        pageSize: maxResults
      });

      const files = response.data.files || [];
      console.log(`📁 Found ${files.length} backup files in Google Drive`);
      
      return files;
    } catch (error) {
      console.error('❌ Error listing backup files:', error);
      throw error;
    }
  }

  /**
   * Delete old backup files from Google Drive
   */
  async cleanupOldBackups(retentionDays: number = 30): Promise<void> {
    if (!this.backupFolderId) {
      await this.initialize();
    }

    try {
      console.log(`🧹 Cleaning up Google Drive backups older than ${retentionDays} days...`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffDateString = cutoffDate.toISOString();

      const response = await this.drive.files.list({
        q: `'${this.backupFolderId}' in parents and createdTime < '${cutoffDateString}' and trashed=false`,
        fields: 'files(id, name, createdTime)',
        orderBy: 'createdTime asc'
      });

      const oldFiles = response.data.files || [];
      let deletedCount = 0;

      for (const file of oldFiles) {
        try {
          await this.drive.files.delete({ fileId: file.id! });
          console.log(`🗑️  Deleted old backup: ${file.name} (${file.createdTime})`);
          deletedCount++;
          
          // Add small delay to avoid rate limiting
          await this.sleep(100);
        } catch (error) {
          console.error(`❌ Error deleting file ${file.name}:`, error);
        }
      }

      console.log(`✅ Cleanup completed. Deleted ${deletedCount} old backup files from Google Drive.`);
    } catch (error) {
      console.error('❌ Error during Google Drive cleanup:', error);
    }
  }

  /**
   * Get backup folder information
   */
  async getBackupFolderInfo(): Promise<drive_v3.Schema$File | null> {
    if (!this.backupFolderId) {
      await this.initialize();
    }

    try {
      const response = await this.drive.files.get({
        fileId: this.backupFolderId!,
        fields: 'id, name, createdTime, modifiedTime, webViewLink, parents'
      });

      return response.data;
    } catch (error) {
      console.error('❌ Error getting backup folder info:', error);
      return null;
    }
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

  /**
   * Utility function for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test Google Drive connection
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing Google Drive connection...');
      
      const response = await this.drive.files.list({
        pageSize: 1,
        fields: 'files(id, name)'
      });

      console.log('✅ Google Drive connection successful');
      return true;
    } catch (error) {
      console.error('❌ Google Drive connection failed:', error);
      return false;
    }
  }
}