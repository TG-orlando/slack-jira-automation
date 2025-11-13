# Slack to Jira Automation

Automatically create Jira tickets when users react with a specific emoji to messages in the `eel-onboarding` Slack channel.

## How It Works

1. A message is posted in the `#eel-onboarding` Slack channel
2. Someone reacts to the message with the trigger emoji (👀 by default)
3. The bot automatically creates a Jira ticket with:
   - The message content as the description
   - The sender's name
   - A link back to the original Slack message
4. A confirmation message is posted in the Slack thread with the Jira ticket link

## Prerequisites

- Node.js (v16 or higher)
- A Slack workspace with admin access
- A Jira account with API access
- npm or yarn package manager

## Setup Instructions

### 1. Slack App Configuration

1. Go to https://api.slack.com/apps and click **Create New App**
2. Choose **From scratch**
3. Name your app (e.g., "Jira Ticket Creator") and select your workspace
4. Click **Create App**

#### Configure OAuth & Permissions

1. In the left sidebar, click **OAuth & Permissions**
2. Scroll to **Scopes** → **Bot Token Scopes**
3. Add the following scopes:
   - `channels:history` - View messages in public channels
   - `channels:read` - View basic channel info
   - `chat:write` - Send messages
   - `reactions:read` - View emoji reactions
   - `users:read` - View user information

4. Scroll to top and click **Install to Workspace**
5. Authorize the app
6. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

#### Enable Socket Mode

1. In the left sidebar, click **Socket Mode**
2. Toggle **Enable Socket Mode** to ON
3. Enter a token name (e.g., "socket-token")
4. Copy the **App-Level Token** (starts with `xapp-`)

#### Enable Event Subscriptions

1. In the left sidebar, click **Event Subscriptions**
2. Toggle **Enable Events** to ON
3. Under **Subscribe to bot events**, add:
   - `reaction_added`
4. Click **Save Changes**

#### Get Signing Secret

1. In the left sidebar, click **Basic Information**
2. Scroll to **App Credentials**
3. Copy the **Signing Secret**

### 2. Jira API Configuration

1. Log in to your Jira account
2. Go to https://id.atlassian.com/manage-profile/security/api-tokens
3. Click **Create API token**
4. Give it a label (e.g., "Slack Integration")
5. Copy the token (you won't be able to see it again)
6. Note your Jira email address and base URL (e.g., `https://yourcompany.atlassian.net`)

### 3. Project Setup

1. Clone or download this project
2. Navigate to the project directory:
   ```bash
   cd slack-jira-automation
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

5. Edit `.env` and fill in your credentials:
   ```env
   # Slack tokens from steps above
   SLACK_BOT_TOKEN=xoxb-your-token-here
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_APP_TOKEN=xapp-your-app-token

   # Channel configuration
   ONBOARDING_CHANNEL=eel-onboarding
   TRIGGER_EMOJI=white_check_mark

   # Jira configuration
   JIRA_BASE_URL=https://yourcompany.atlassian.net
   JIRA_EMAIL=your-email@company.com
   JIRA_API_TOKEN=your-jira-api-token
   JIRA_PROJECT_KEY=PROJ
   JIRA_ISSUE_TYPE=Task
   ```

### 4. Invite the Bot to the Channel

1. In Slack, go to the `#eel-onboarding` channel
2. Type `/invite @YourBotName` (replace with your bot's name)
3. Press Enter

## Running the Automation

### Development Mode

```bash
npm run dev
```

This uses nodemon to automatically restart when you make changes.

### Production Mode

```bash
npm start
```

## Configuration Options

### Changing the Trigger Emoji

Edit the `TRIGGER_EMOJI` in your `.env` file. Use the emoji name (not the emoji itself):

- 👀 = `eyes` (default)
- ✅ = `white_check_mark`
- 👍 = `+1`
- ✔️ = `heavy_check_mark`
- 🎫 = `ticket`

### Custom Jira Fields

To populate custom Jira fields, set the `JIRA_CUSTOM_FIELDS` environment variable with a JSON object:

```env
JIRA_CUSTOM_FIELDS={"customfield_10001":"Onboarding","labels":["slack","onboarding"]}
```

To find custom field IDs:
1. Go to Jira → Settings → Issues → Custom fields
2. Click on the field and note the ID in the URL

### Changing the Issue Type

Set `JIRA_ISSUE_TYPE` to match your Jira project's issue types:
- `Task`
- `Story`
- `Bug`
- `Epic`
- Or any custom issue type in your project

## Deployment

### Option 1: Run on a Server

1. Deploy to any Node.js hosting service (AWS EC2, DigitalOcean, Heroku, etc.)
2. Set environment variables in your hosting platform
3. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start app.js --name slack-jira-bot
   pm2 save
   pm2 startup
   ```

### Option 2: Run as a Service (Linux)

Create a systemd service file `/etc/systemd/system/slack-jira-bot.service`:

```ini
[Unit]
Description=Slack Jira Bot
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/slack-jira-automation
ExecStart=/usr/bin/node app.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable slack-jira-bot
sudo systemctl start slack-jira-bot
```

### Option 3: Docker

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "app.js"]
```

Build and run:
```bash
docker build -t slack-jira-bot .
docker run -d --env-file .env --name slack-jira-bot slack-jira-bot
```

## Troubleshooting

### Bot doesn't respond to reactions

1. Check that the bot is invited to the `#eel-onboarding` channel
2. Verify the `TRIGGER_EMOJI` matches the emoji you're using
3. Check the app logs for errors
4. Ensure Event Subscriptions are enabled in Slack app settings

### Jira ticket creation fails

1. Verify your Jira API token is valid
2. Check that the `JIRA_PROJECT_KEY` exists and you have permission to create issues
3. Ensure the `JIRA_ISSUE_TYPE` exists in your project
4. Check that your Jira email is correct

### "Already processed" messages

The bot stores processed reactions in memory to avoid duplicates. If you restart the bot, this cache is cleared.

## Testing

1. Post a message in `#eel-onboarding`
2. React to it with 👀 (or your configured emoji)
3. Check that:
   - A Jira ticket is created
   - A confirmation message appears in the thread
   - The Jira ticket contains the message content and link

## Support

For issues or questions, check the logs first:
```bash
# If using npm start
Check the console output

# If using PM2
pm2 logs slack-jira-bot

# If using systemd
sudo journalctl -u slack-jira-bot -f
```

## License

MIT
