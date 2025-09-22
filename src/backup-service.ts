import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { parse } from 'pg-connection-string';
import { DatabaseActivity } from './neon-discovery';
import archiver from 'archiver';

export interface BackupResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  sqlFilePath?: string; // Path to the original SQL file
  zipFilePath?: string; // Path to the compressed ZIP file
  error?: string;
  duration?: number;
}

export interface BackupOptions {
  outputDir?: string;
  compressionLevel?: number;
  includeBlobs?: boolean;
  includePrivileges?: boolean;
  customFormat?: boolean;
}

export class DatabaseBackupService {
  private outputDir: string;
  private defaultOptions: BackupOptions;

  constructor(outputDir: string = './backups', options: BackupOptions = {}) {
    this.outputDir = outputDir;
    this.defaultOptions = {
      outputDir,
      compressionLevel: 6,
      includeBlobs: true,
      includePrivileges: true,
      customFormat: false, // Use plain SQL format for readability
      ...options
    };
  }

  /**
   * Initialize the backup service by creating necessary directories
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      console.log(`📁 Backup directory initialized: ${this.outputDir}`);
    } catch (error) {
      console.error('❌ Error initializing backup directory:', error);
      throw error;
    }
  }

  /**
   * Compress a SQL file to ZIP format
   */
  private async compressToZip(sqlFilePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const zipFilePath = sqlFilePath.replace(/\.sql$/, '.zip');
      const output = require('fs').createWriteStream(zipFilePath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });

      output.on('close', () => {
        console.log(`📦 Compressed to ZIP: ${archive.pointer()} bytes`);
        resolve(zipFilePath);
      });

      archive.on('error', (err: Error) => {
        reject(err);
      });

      archive.pipe(output);
      
      // Add the SQL file to the ZIP
      const fileName = require('path').basename(sqlFilePath);
      archive.file(sqlFilePath, { name: fileName });
      
      archive.finalize();
    });
  }

  /**
   * Generate a backup filename
   */
  private generateBackupFileName(projectName: string, branchName: string, customFormat: boolean = true): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const sanitizedProjectName = projectName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const sanitizedBranchName = branchName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const extension = customFormat ? 'dump' : 'sql';
    
    return `${sanitizedProjectName}_${sanitizedBranchName}_${timestamp}.${extension}`;
  }

  /**
   * Create a database backup using pg_dump
   */
  async createBackup(
    resource: DatabaseActivity, 
    options: BackupOptions = {}
  ): Promise<BackupResult> {
    const startTime = Date.now();
    const mergedOptions = { ...this.defaultOptions, ...options };
    
    if (!resource.connection_uri) {
      return {
        success: false,
        error: 'No connection URI provided'
      };
    }

    console.log(`🗄️  Starting backup for ${resource.project_name}/${resource.branch_name}...`);

    try {
      // Parse connection URI
      const config = parse(resource.connection_uri);
      
      if (!config.host || !config.database || !config.user) {
        throw new Error('Invalid connection URI - missing required fields');
      }

      // Generate backup filename
      const fileName = this.generateBackupFileName(
        resource.project_name, 
        resource.branch_name, 
        mergedOptions.customFormat
      );
      const filePath = join(this.outputDir, fileName);

      // Build pg_dump command arguments
      const args: string[] = [];
      
      // Connection parameters
      args.push(`--host=${config.host}`);
      args.push(`--port=${config.port || 5432}`);
      args.push(`--username=${config.user}`);
      args.push(`--dbname=${config.database}`);
      
      // Backup options
      if (mergedOptions.customFormat) {
        args.push('--format=custom');
      } else {
        args.push('--format=plain');
        args.push('--column-inserts'); // Use INSERT statements instead of COPY
      }
      
      if (mergedOptions.compressionLevel !== undefined && mergedOptions.customFormat) {
        args.push(`--compress=${mergedOptions.compressionLevel}`);
      }
      
      if (mergedOptions.includeBlobs) {
        args.push('--blobs');
      }
      
      if (mergedOptions.includePrivileges) {
        args.push('--no-privileges');
      } else {
        args.push('--no-acl');
      }
      
      // Output options
      args.push('--verbose');
      args.push('--no-password');
      args.push(`--file=${filePath}`);

      // Set environment variables for connection
      const env = {
        ...process.env,
        PGPASSWORD: config.password || '',
        PGSSLMODE: 'require'
      };

      // Execute pg_dump
      const result = await this.executePgDump(args, env);

      if (result.success) {
        // Get original SQL file size
        const sqlStats = await fs.stat(filePath);
        const sqlFileSize = sqlStats.size;
        
        console.log(`✅ SQL backup completed: ${fileName} (${this.formatFileSize(sqlFileSize)})`);
        
        // Compress the SQL file to ZIP
        console.log(`📦 Compressing SQL file to ZIP...`);
        const zipFilePath = await this.compressToZip(filePath);
        const zipStats = await fs.stat(zipFilePath);
        const zipFileSize = zipStats.size;
        const duration = Date.now() - startTime;
        
        console.log(`✅ Backup completed: ${require('path').basename(zipFilePath)} (${this.formatFileSize(zipFileSize)}) in ${duration}ms`);
        console.log(`📊 Compression ratio: ${Math.round((1 - zipFileSize / sqlFileSize) * 100)}%`);

        return {
          success: true,
          filePath: zipFilePath, // Return ZIP file path for upload
          fileName: require('path').basename(zipFilePath),
          fileSize: zipFileSize,
          sqlFilePath: filePath,
          zipFilePath: zipFilePath,
          duration
        };
      } else {
        return {
          success: false,
          error: result.error
        };
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Backup failed for ${resource.project_name}/${resource.branch_name}:`, error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration
      };
    }
  }

  /**
   * Get the pg_dump executable path
   */
  private getPgDumpPath(): string {
    // On Windows, try common PostgreSQL installation paths
    if (process.platform === 'win32') {
      const commonPaths = [
        'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe',
        'C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\pg_dump.exe',
        'C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\pg_dump.exe',
        'C:\\Program Files (x86)\\PostgreSQL\\15\\bin\\pg_dump.exe',
        'C:\\Program Files (x86)\\PostgreSQL\\14\\bin\\pg_dump.exe'
      ];
      
      const fs = require('fs');
      for (const path of commonPaths) {
        try {
          if (fs.existsSync(path)) {
            console.log(`🔍 Found pg_dump at: ${path}`);
            return path;
          }
        } catch {
          // Continue to next path
        }
      }
    }
    
    // Default to 'pg_dump' (assumes it's in PATH)
    return 'pg_dump';
  }
  
  /**
   * Execute pg_dump command
   */
  private async executePgDump(args: string[], env: NodeJS.ProcessEnv): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const pgDumpPath = this.getPgDumpPath();
      const process = spawn(pgDumpPath, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';
      let stdout = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ 
            success: false, 
            error: `pg_dump exited with code ${code}. stderr: ${stderr}` 
          });
        }
      });

      process.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          resolve({ 
            success: false, 
            error: `pg_dump not found. Please install PostgreSQL client tools. On Windows: Download from https://www.postgresql.org/download/windows/ or use: winget install PostgreSQL.PostgreSQL` 
          });
        } else {
          resolve({ 
            success: false, 
            error: `Failed to start pg_dump: ${error.message}` 
          });
        }
      });
    });
  }

  /**
   * Create backups for multiple resources
   */
  async createMultipleBackups(
    resources: DatabaseActivity[], 
    options: BackupOptions = {}
  ): Promise<BackupResult[]> {
    console.log(`🚀 Starting backup process for ${resources.length} resources...`);
    
    await this.initialize();
    
    const results: BackupResult[] = [];
    
    for (const resource of resources) {
      try {
        const result = await this.createBackup(resource, options);
        results.push(result);
        
        // Add a small delay between backups to avoid overwhelming the database
        await this.sleep(1000);
      } catch (error) {
        console.error(`❌ Unexpected error backing up ${resource.project_name}/${resource.branch_name}:`, error);
        results.push({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log(`\n📊 Backup Summary:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);
    console.log(`   📁 Output directory: ${this.outputDir}`);

    return results;
  }

  /**
   * Clean up old backup files
   */
  async cleanupOldBackups(retentionDays: number = 7): Promise<void> {
    try {
      console.log(`🧹 Cleaning up backups older than ${retentionDays} days...`);
      
      const files = await fs.readdir(this.outputDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      let deletedCount = 0;

      for (const file of files) {
        if (file.endsWith('.dump') || file.endsWith('.sql') || file.endsWith('.zip')) {
          const filePath = join(this.outputDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime < cutoffDate) {
            await fs.unlink(filePath);
            deletedCount++;
            console.log(`🗑️  Deleted old backup: ${file}`);
          }
        }
      }

      console.log(`✅ Cleanup completed. Deleted ${deletedCount} old backup files.`);
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
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
   * Check if pg_dump is available
   */
  async checkPgDumpAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const pgDumpPath = this.getPgDumpPath();
      const process = spawn(pgDumpPath, ['--version'], { stdio: 'pipe' });
      
      process.on('close', (code) => {
        resolve(code === 0);
      });
      
      process.on('error', () => {
        resolve(false);
      });
    });
  }
}