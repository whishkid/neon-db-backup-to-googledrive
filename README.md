# Neon Database Backup to Google Drive

This GitHub Action automatically discovers all Neon database projects and branches, checks for recent data modifications, and creates backups to Google Drive.

## 🚀 Features

- **Automatic Discovery**: Finds all projects and branches in your Neon account
- **Smart Filtering**: Only backs up branches with recent modifications using branch timestamps (configurable timeframe)
- **Google Drive Integration**: Uploads backups to a dedicated folder in Google Drive
- **Scheduled Execution**: Runs automatically on a schedule or manually triggered
- **Cleanup Management**: Automatically removes old backup files
- **Comprehensive Logging**: Detailed logs for monitoring and troubleshooting

## 📋 Prerequisites

1. **Neon Account**: Active Neon account with API access
2. **Google Cloud Project**: With Google Drive API enabled
3. **Service Account**: Google service account with Drive API permissions

## 🔧 Setup Instructions

### 1. Create Neon API Key

1. Log in to the [Neon Console](https://console.neon.tech/)
2. Navigate to [Account settings > API keys](https://console.neon.tech/app/settings/api-keys)
3. Click "Generate new API key"
4. Enter a descriptive name (e.g., "backup-action")
5. Copy the generated API key

### 2. Set up Google Drive API

#### Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click "Enable"

#### Create a Service Account
1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in the service account details
4. Grant the service account "Editor" role
5. Create and download the JSON key file

#### Share Google Drive Folder (Optional)
If you want to use a specific folder:
1. Create a folder in Google Drive named "neonbackups"
2. Right-click the folder and select "Share"
3. Add the service account email (from the JSON file) with "Editor" permissions

### 3. Configure GitHub Repository Secrets

Add the following secrets to your GitHub repository:

| Secret Name | Description | Required |
|-------------|-------------|----------|
| `NEON_API_KEY` | Your Neon API key | ✅ Yes |
| `GOOGLE_DRIVE_CREDENTIALS` | Service account JSON (entire file content) | ✅ Yes |

To add secrets:
1. Go to your repository on GitHub
2. Click "Settings" > "Secrets and variables" > "Actions"
3. Click "New repository secret"
4. Add each secret with the exact names above

## 📅 Usage

### Automatic Execution (Scheduled)

The action runs automatically every day at 2 AM UTC. You can modify the schedule in `.github/workflows/backup.yml`:

```yaml
schedule:
  - cron: '0 2 * * *'  # Daily at 2 AM UTC
```

### Manual Execution

1. Go to your repository on GitHub
2. Click "Actions" tab
3. Select "Neon Database Backup to Google Drive" workflow
4. Click "Run workflow"
5. Optionally configure parameters:
   - **Retention Days**: How many days back to check for modifications (default: 7)
   - **Cleanup Old Backups**: Whether to remove old backup files (default: true)
   - **Cleanup Retention Days**: How long to keep backups (default: 30)

### Local Development

For testing locally:

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file:
   ```env
   NEON_API_KEY=your_neon_api_key_here
   GOOGLE_DRIVE_CREDENTIALS={"type": "service_account", "project_id": "...", ...}
   BACKUP_RETENTION_DAYS=7
   CLEANUP_OLD_BACKUPS=true
   CLEANUP_RETENTION_DAYS=30
   ```

4. Build and run:
   ```bash
   npm run build
   npm run dev
   ```

## ⚙️ Configuration Options

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NEON_API_KEY` | Neon API key | - | ✅ |
| **Google Drive Authentication (choose one)** |
| `GOOGLE_CLIENT_ID` | OAuth client ID (recommended) | - | 🔄 |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (recommended) | - | 🔄 |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token (recommended) | - | 🔄 |
| `GOOGLE_DRIVE_CREDENTIALS` | Service account JSON (shared drives only) | - | 🔄 |
| **Backup Configuration** |
| `BACKUP_RETENTION_DAYS` | Days to check for modifications | 7 | ❌ |
| `OUTPUT_DIR` | Local backup directory | ./backups | ❌ |
| `CLEANUP_OLD_BACKUPS` | Enable cleanup of old backups | true | ❌ |
| `CLEANUP_RETENTION_DAYS` | Days to keep backups | 30 | ❌ |

> **Note**: For personal Google accounts, use OAuth authentication (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN). For Google Workspace with shared drives, use service account credentials. See [Google OAuth Setup Guide](./GOOGLE_OAUTH_SETUP.md) for detailed instructions.

### Workflow Inputs (Manual Execution)

When running manually, you can override these settings:

- **retention_days**: Number of days to check for data modifications
- **cleanup_old_backups**: Whether to cleanup old backup files
- **cleanup_retention_days**: Number of days to retain backups

## 📁 Output Structure

### Local Backups (Temporary)
```
./backups/
├── project1_branch1_2024-01-15_120000.dump
├── project1_branch2_2024-01-15_120001.dump
└── project2_main_2024-01-15_120002.dump
```

### Google Drive Structure
```
Google Drive/
└── neonbackups/
    ├── project1_branch1_2024-01-15_120000.dump
    ├── project1_branch2_2024-01-15_120001.dump
    └── project2_main_2024-01-15_120002.dump
```

## 🔍 How It Works

1. **Discovery Phase**:
   - Lists all projects in your Neon account
   - Discovers all branches for each project
   - Uses branch `updated_at` timestamp to check for recent activity

2. **Activity Check**:
   - Compares branch `updated_at` with retention period
   - Filters branches based on the configurable timeframe
   - Only includes branches with recent modifications

3. **Backup Creation**:
   - Uses `pg_dump` to create database backups
   - Generates compressed custom format dumps
   - Stores backups locally temporarily

4. **Upload to Google Drive**:
   - Uploads backup files to the `neonbackups` folder
   - Maintains original filenames with timestamps
   - Provides file metadata and sharing links

5. **Cleanup**:
   - Removes local backup files after upload
   - Optionally cleans up old backups from Google Drive
   - Maintains retention policies

## 🔧 Troubleshooting

### Common Issues

#### "pg_dump: command not found"
- **Solution**: The workflow installs PostgreSQL client automatically. For local development, install PostgreSQL tools.

#### "Google Drive authentication failed"
- **Solution**: Verify that the service account JSON is correctly formatted and the Google Drive API is enabled.

#### "Neon API authentication failed"
- **Solution**: Check that your Neon API key is valid and has the necessary permissions.

#### "No active resources found"
- **Solution**: This is normal if no databases have been modified recently. Adjust the `BACKUP_RETENTION_DAYS` if needed.

### Enable Debug Logging

Add this to your workflow file for detailed logs:

```yaml
env:
  NODE_ENV: development
  DEBUG: '*'
```

### Check Backup Status

Monitor the Actions tab in your GitHub repository for:
- Execution logs
- Success/failure status
- Backup statistics
- Error messages

## 📊 Monitoring and Notifications

### Built-in Notifications

The workflow includes basic success/failure notifications. For advanced notifications, uncomment and configure the Slack section in `.github/workflows/backup.yml`.

### Metrics Tracked

- Number of projects discovered
- Number of branches with recent activity
- Number of successful backups
- Number of successful uploads
- Total backup size
- Execution duration

## 🔒 Security Considerations

1. **API Keys**: Store sensitive information only in GitHub Secrets
2. **Service Account**: Use minimal required permissions for Google Drive
3. **Network**: All connections use SSL/TLS encryption
4. **Cleanup**: Local backup files are automatically removed after upload

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

- **Issues**: Report bugs or request features via GitHub Issues
- **Discussions**: Use GitHub Discussions for questions and community support
- **Documentation**: Check the [Neon Documentation](https://neon.com/docs) for database-specific questions