# Admin Handover Guide - Slack-Jira Automation

This document explains how to maintain and troubleshoot the Slack-to-Jira automation that creates "New Hire Onboarding" tickets when users react with 👀 to messages in #eel-onboarding.

## System Overview

**What it does:**
- Monitors #eel-onboarding Slack channel
- When someone reacts with 👀 to a message, it creates a Jira Service Desk ticket
- Automatically parses employee details from Rippling messages
- Populates Jira "New Hire Onboarding" request with: Name, Start Date, Email, Department, Manager, Employment Type

**Where it runs:**
- **Hosting**: Railway (cloud platform) - runs 24/7
- **Source Code**: GitHub repository at https://github.com/TG-orlando/slack-jira-automation
- **Auto-Deploy**: Any push to the `main` branch automatically deploys to Railway

## Access Requirements

To manage this system, you need access to:

1. **Railway Account**: Where the app runs
   - URL: https://railway.app
   - Login with GitHub account that has access to TG-orlando organization

2. **GitHub Repository**: Where the code lives
   - URL: https://github.com/TG-orlando/slack-jira-automation
   - Need write access to this repo

3. **Slack Workspace**: To manage the Slack app
   - Go to: https://api.slack.com/apps
   - Find app: "Jira Ticket Creator" (or similar name)
   - Need admin access to workspace

4. **Jira Account**: To manage API access
   - Admin access to https://theguarantors.atlassian.net
   - Access to ORCAS project

## Checking if the System is Running

### In Railway:
1. Go to https://railway.app
2. Navigate to your project
3. Check the deployment status - should show "Active" with green indicator
4. Click on "Deployments" tab to see recent activity
5. Click "View Logs" to see real-time output

### Quick Health Check:
1. Post a test message in #eel-onboarding
2. React with 👀 emoji
3. Within 5-10 seconds, you should see:
   - A reply in the Slack thread with the Jira ticket link
   - A new ticket in Jira ORCAS project queue

## Environment Variables (Critical Configuration)

These are stored in Railway and contain all credentials. To view/edit:

1. Go to Railway project
2. Click on your service
3. Go to "Variables" tab

**Required Variables:**

```
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=xapp-your-app-token-here

ONBOARDING_CHANNEL=eel-onboarding
TRIGGER_EMOJI=eyes

JIRA_BASE_URL=https://theguarantors.atlassian.net
JIRA_EMAIL=orlando.roberts@theguarantors.com
JIRA_API_TOKEN=your-jira-api-token-here

JIRA_PROJECT_KEY=ORCAS
JIRA_ISSUE_TYPE=New Hire Onboarding
```

**IMPORTANT:** The actual token values are stored in Railway Variables tab - never commit real tokens to GitHub. Check Railway for the current production values.

## Common Issues and Solutions

### Issue 1: Tickets Stop Being Created

**Symptoms:** React with 👀 but nothing happens

**Troubleshooting steps:**

1. **Check Railway logs:**
   ```
   - Go to Railway project
   - Click "View Logs"
   - Look for errors (red text)
   ```

2. **Common causes:**
   - **Slack token expired**: See "Regenerating Slack Tokens" section below
   - **Jira token expired**: See "Regenerating Jira Token" section below
   - **Railway deployment crashed**: Check deployment status, redeploy if needed
   - **Bot not in channel**: Invite bot to #eel-onboarding with `/invite @BotName`

3. **Check Slack app permissions:**
   - Go to https://api.slack.com/apps
   - Select your app
   - Go to "OAuth & Permissions"
   - Verify these scopes are present:
     - `channels:history`
     - `channels:read`
     - `groups:read`
     - `chat:write`
     - `reactions:read`
     - `users:read`

### Issue 2: Tickets Created But Fields Are Empty

**Symptoms:** Ticket is created but Name, Start Date, etc. are blank

**Likely cause:** Rippling message format changed

**Solution:**
1. Check Railway logs for parsed details
2. Look for "Parsed Rippling details:" in logs
3. If parsing fails, the message format may have changed
4. Contact the developer who set this up or check `parseRipplingMessage()` function in app.js

### Issue 3: Railway Deployment Fails

**Symptoms:** Code pushed to GitHub but Railway shows "Failed" deployment

**Solution:**
1. Click on failed deployment in Railway
2. Check build logs for errors
3. Common issues:
   - Missing dependencies: Run `npm install` locally and commit package-lock.json
   - Syntax errors: Fix in code and push again
   - Environment variables missing: Verify in Railway Variables tab

## Regenerating Tokens (When They Expire)

### Regenerating Slack Tokens

Slack tokens may expire or need rotation for security.

**Steps:**

1. **Go to Slack App Settings:**
   - Visit: https://api.slack.com/apps
   - Click on your app (e.g., "Jira Ticket Creator")

2. **Bot Token (SLACK_BOT_TOKEN):**
   - Go to "OAuth & Permissions"
   - Under "OAuth Tokens for Your Workspace"
   - Click "Reinstall App" (or "Install to Workspace" if removed)
   - Copy the new "Bot User OAuth Token" (starts with `xoxb-`)
   - Update `SLACK_BOT_TOKEN` in Railway

3. **App Token (SLACK_APP_TOKEN):**
   - Go to "Basic Information"
   - Scroll to "App-Level Tokens"
   - Click "Generate Token and Scopes"
   - Add scope: `connections:write`
   - Copy token (starts with `xapp-`)
   - Update `SLACK_APP_TOKEN` in Railway

4. **Signing Secret (SLACK_SIGNING_SECRET):**
   - Go to "Basic Information"
   - Under "App Credentials"
   - Copy "Signing Secret"
   - Update `SLACK_SIGNING_SECRET` in Railway

5. **After updating Railway variables:**
   - Railway will automatically redeploy
   - Check logs to verify it started successfully

### Regenerating Jira Token

Jira API tokens don't expire automatically but may need rotation.

**Steps:**

1. **Generate new token:**
   - Go to: https://id.atlassian.com/manage-profile/security/api-tokens
   - Log in with the account used for integration (orlando.roberts@theguarantors.com)
   - Click "Create API token"
   - Label: "Slack Integration - [Today's Date]"
   - Copy the token immediately (can't view it again)

2. **Update Railway:**
   - Go to Railway Variables tab
   - Update `JIRA_API_TOKEN` with new token
   - Verify `JIRA_EMAIL` matches the account that created the token

3. **Revoke old token:**
   - Back in Atlassian API tokens page
   - Find the old token
   - Click "Revoke" to disable it

## Making Changes to the Automation

### Changing the Trigger Emoji

Current: 👀 (eyes)

To change to a different emoji:

1. Go to Railway Variables
2. Edit `TRIGGER_EMOJI`
3. Use emoji name (NOT the emoji itself):
   - ✅ = `white_check_mark`
   - 👍 = `+1`
   - 🎫 = `ticket`
   - Find names at: https://www.webfx.com/tools/emoji-cheat-sheet/
4. Save - Railway will redeploy automatically

### Changing the Monitored Channel

Current: eel-onboarding

To monitor a different channel:

1. Go to Railway Variables
2. Edit `ONBOARDING_CHANNEL`
3. Use channel name without # (e.g., `new-hires`)
4. Invite the bot to the new channel: `/invite @BotName`
5. Save - Railway will redeploy

### Modifying the Code

**For developers who need to change functionality:**

1. **Clone the repository:**
   ```bash
   git clone https://github.com/TG-orlando/slack-jira-automation.git
   cd slack-jira-automation
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create local .env file for testing:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials (get from Railway Variables)
   ```

4. **Test locally:**
   ```bash
   npm run dev
   ```

5. **Make changes to app.js**

6. **Commit and push:**
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin main
   ```

7. **Railway auto-deploys** - check logs to verify deployment succeeded

## Important Technical Details

### Service Desk Configuration

The automation uses Jira Service Desk API with these specific IDs:

- **Service Desk ID**: 38
- **Request Type**: "New Hire Onboarding" (ID: 690)
- **Project Key**: ORCAS

**Field Mappings:**
- `customfield_10496` - Name
- `customfield_10014` - Start Date (format: yyyy-MM-dd)
- `customfield_10111` - Email
- `customfield_10177` - Manager Information
- `customfield_10494` - Department
- `customfield_10495` - Employment Type
- Summary - Single line summary
- Priority - Default "Low"

**If Jira fields change:**
1. Check Railway logs for field validation errors
2. The system fetches field metadata dynamically
3. May need to update field mapping in app.js:154-195

### Fallback Mechanism

If Service Desk API fails, the system automatically falls back to creating a regular "Task" issue type. Check logs for "Falling back to regular Jira API" message.

## Emergency Contacts

**If you need help:**

1. **Check the logs first** - 90% of issues are visible in Railway logs
2. **GitHub Issues**: Report bugs at https://github.com/TG-orlando/slack-jira-automation/issues
3. **Slack API Support**: https://api.slack.com/support
4. **Jira Support**: Contact Atlassian support through your admin portal

## Testing Checklist

After making any changes, verify:

- [ ] Railway deployment shows "Active" status
- [ ] Railway logs show "⚡️ Bolt app is running!"
- [ ] Post test message in #eel-onboarding
- [ ] React with 👀 emoji
- [ ] Jira ticket is created within 10 seconds
- [ ] Ticket has correct fields populated
- [ ] Slack thread receives reply with ticket link

## Security Notes

**CRITICAL - Do not share publicly:**
- API tokens grant full access to Slack and Jira
- Only share with trusted team members who need access
- Rotate tokens if potentially compromised
- Never commit .env file to GitHub
- GitHub repository can be public (it has .gitignore protecting secrets)

**Token Scope:**
- Slack bot token can only access channels it's invited to
- Jira token has full access to create/edit issues
- Restrict Railway access to authorized admins only

## Monitoring

**Set up alerts (recommended):**

1. **In Railway:**
   - Enable deployment notifications
   - Get alerts if deployment fails

2. **In Slack:**
   - Monitor #eel-onboarding for bot activity
   - If bot stops responding, check immediately

3. **Weekly health check:**
   - Test the workflow once a week
   - Verify tickets are being created correctly

## Backup and Recovery

**The system is stateless** - it doesn't store any data locally.

**To restore if Railway project is deleted:**

1. Create new Railway project
2. Connect to GitHub repository
3. Set all environment variables from this document
4. Deploy from main branch
5. Verify bot is invited to #eel-onboarding

**To restore if GitHub repo is deleted:**

1. Clone from Railway deployment or local copy
2. Create new GitHub repository
3. Push code to new repo
4. Update Railway to use new repo

## Changelog

Keep track of changes:

| Date | Change | Changed By |
|------|--------|------------|
| 2025-11-14 | Initial deployment | Orlando Roberts |
| | | |

Add new rows when making significant changes.
