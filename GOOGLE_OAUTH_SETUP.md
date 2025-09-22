# Google Drive OAuth Setup Guide

The backup system now supports both Service Account and OAuth authentication for Google Drive. For personal Google accounts, OAuth is recommended.

## Why OAuth Instead of Service Account?

Service accounts don't have their own Google Drive storage quota, so they can't upload files to regular Google Drive folders. OAuth allows the application to act on behalf of your personal Google account, using your Google Drive storage.

## Setting Up Google OAuth

### Step 1: Create Google Cloud Project and Enable Drive API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API:
   - Go to **APIs & Services** > **Library**
   - Search for "Google Drive API"
   - Click on it and press **Enable**

### Step 2: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **+ CREATE CREDENTIALS** > **OAuth 2.0 Client IDs**
3. If prompted, configure the OAuth consent screen:
   - Choose **External** (unless you have a Google Workspace)
   - Fill in required fields (App name, User support email, Developer contact)
   - Add your email to Test users
4. For Application type, choose **Desktop application**
5. Give it a name (e.g., "Neon Database Backup")
6. Click **Create**
7. Download the JSON file or copy the Client ID and Client Secret

### Step 3: Get Refresh Token

You need to get a refresh token that allows the application to access your Google Drive without manual intervention.

#### Option A: Using Google OAuth 2.0 Playground (Easiest)

1. Go to [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in the top right
3. Check **Use your own OAuth credentials**
4. Enter your Client ID and Client Secret from Step 2
5. In the left panel, find **Drive API v3** and select:
   - `https://www.googleapis.com/auth/drive.file`
6. Click **Authorize APIs**
7. Sign in with your Google account and grant permissions
8. Click **Exchange authorization code for tokens**
9. Copy the **Refresh token** value

#### Option B: Using Node.js Script

Create a temporary script to get the refresh token:

```javascript
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET',
  'urn:ietf:wg:oauth:2.0:oob'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

console.log('Visit this URL to get authorization code:');
console.log(authUrl);
console.log('\nAfter authorization, enter the code here:');

// Then use the code to get tokens:
// const { tokens } = await oauth2Client.getToken(authorizationCode);
// console.log('Refresh Token:', tokens.refresh_token);
```

### Step 4: Update Environment Variables

Update your `.env` file with the OAuth credentials:

```env
# Neon Database Configuration
NEON_API_KEY=your_neon_api_key_here

# Google Drive OAuth Configuration (use instead of service account)
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REFRESH_TOKEN=your_refresh_token_here

# Backup Configuration
BACKUP_RETENTION_DAYS=7
OUTPUT_DIR=./backups
CLEANUP_OLD_BACKUPS=true
CLEANUP_RETENTION_DAYS=30
```

### Step 5: Test the Setup

Run the backup system:

```bash
npm run dev
```

The system will now use OAuth to authenticate with Google Drive and should successfully upload backups to your personal Google Drive in a folder called "neonbackups".

## Troubleshooting

### Error: "invalid_grant"
- Your refresh token may have expired (they can expire if not used for 6 months)
- Regenerate a new refresh token using the OAuth playground

### Error: "access_denied"
- Make sure your email is added to the test users in the OAuth consent screen
- Ensure the Google Drive API is enabled in your project

### Error: "redirect_uri_mismatch"
- Make sure you're using the correct redirect URI: `urn:ietf:wg:oauth:2.0:oob`

## Security Notes

- Keep your Client Secret and Refresh Token secure
- For GitHub Actions, use repository secrets to store these values
- Consider using a dedicated Google account for backups rather than your personal account
- The refresh token allows long-term access to your Google Drive, so treat it like a password

## GitHub Actions Setup

For GitHub Actions, add these secrets to your repository:

1. Go to your repository on GitHub
2. Click **Settings** > **Secrets and variables** > **Actions**
3. Add the following secrets:
   - `NEON_API_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`

The GitHub Actions workflow will automatically use these secrets when running the backup process.