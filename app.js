require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Configuration
const TRIGGER_EMOJI = process.env.TRIGGER_EMOJI || 'eyes'; // 👀 by default
const ONBOARDING_CHANNEL = process.env.ONBOARDING_CHANNEL || 'eel-onboarding';
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY;
const JIRA_ISSUE_TYPE = process.env.JIRA_ISSUE_TYPE || 'Task';

// Store processed reactions to avoid duplicates
const processedReactions = new Set();

/**
 * Create a Jira ticket using standard API
 */
async function createJiraTicket(messageData) {
  const jiraUrl = `${process.env.JIRA_BASE_URL}/rest/api/2/issue`;

  // Prepare description text (v2 API uses simple text, not ADF)
  const description = `Onboarding request from Slack:\n\n${messageData.text}\n\nRequested by: ${messageData.userName}\n\nSlack Message Link: ${messageData.messageLink}`;

  // Prepare the issue data
  const issueData = {
    fields: {
      project: {
        key: JIRA_PROJECT_KEY
      },
      summary: `Onboarding Request - ${new Date().toLocaleDateString()}`,
      description: description,
      issuetype: {
        name: JIRA_ISSUE_TYPE
      }
    }
  };

  // Add custom fields if configured
  if (process.env.JIRA_CUSTOM_FIELDS) {
    try {
      const customFields = JSON.parse(process.env.JIRA_CUSTOM_FIELDS);
      Object.assign(issueData.fields, customFields);
    } catch (error) {
      console.error('Error parsing JIRA_CUSTOM_FIELDS:', error);
    }
  }

  try {
    const response = await axios.post(jiraUrl, issueData, {
      headers: {
        'Authorization': `Basic ${Buffer.from(
          `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
        ).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error creating Jira ticket:');
    console.error('Status:', error.response?.status);
    console.error('Error Messages:', JSON.stringify(error.response?.data?.errorMessages, null, 2));
    console.error('Field Errors:', JSON.stringify(error.response?.data?.errors, null, 2));
    throw error;
  }
}

/**
 * Get channel name from channel ID
 */
async function getChannelName(client, channelId) {
  try {
    const result = await client.conversations.info({
      channel: channelId
    });
    return result.channel.name;
  } catch (error) {
    console.error('Error fetching channel info:', error);
    return null;
  }
}

/**
 * Get user name from user ID
 */
async function getUserName(client, userId) {
  try {
    const result = await client.users.info({
      user: userId
    });
    return result.user.real_name || result.user.name;
  } catch (error) {
    console.error('Error fetching user info:', error);
    return 'Unknown User';
  }
}

/**
 * Get the permalink for a message
 */
async function getMessageLink(client, channelId, messageTs) {
  try {
    const result = await client.chat.getPermalink({
      channel: channelId,
      message_ts: messageTs
    });
    return result.permalink;
  } catch (error) {
    console.error('Error getting message permalink:', error);
    return 'Link unavailable';
  }
}

/**
 * Extract full text content from a Slack message, including blocks and attachments
 */
function extractMessageText(message) {
  let fullText = '';

  // Get main text field
  if (message.text) {
    fullText += message.text;
  }

  // Extract text from blocks (used by apps like Rippling)
  if (message.blocks && message.blocks.length > 0) {
    const blockTexts = message.blocks.map(block => {
      if (block.type === 'section' && block.text) {
        return block.text.text;
      } else if (block.type === 'rich_text' && block.elements) {
        // Handle rich text blocks
        return block.elements.map(element => {
          if (element.elements) {
            return element.elements.map(e => e.text || '').join('');
          }
          return '';
        }).join('\n');
      }
      return '';
    }).filter(text => text.length > 0);

    if (blockTexts.length > 0) {
      if (fullText) fullText += '\n\n';
      fullText += blockTexts.join('\n\n');
    }
  }

  // Extract text from attachments
  if (message.attachments && message.attachments.length > 0) {
    const attachmentTexts = message.attachments.map(att => {
      let attText = '';
      if (att.pretext) attText += att.pretext + '\n';
      if (att.text) attText += att.text + '\n';
      if (att.fields) {
        att.fields.forEach(field => {
          if (field.title) attText += `*${field.title}*\n`;
          if (field.value) attText += `${field.value}\n`;
        });
      }
      return attText.trim();
    }).filter(text => text.length > 0);

    if (attachmentTexts.length > 0) {
      if (fullText) fullText += '\n\n';
      fullText += attachmentTexts.join('\n\n');
    }
  }

  return fullText || 'No message content available';
}

// Listen for reaction_added events
app.event('reaction_added', async ({ event, client, logger }) => {
  try {
    const { reaction, item, user } = event;

    // Create a unique identifier for this reaction
    const reactionId = `${item.channel}-${item.ts}-${user}-${reaction}`;

    // Check if we've already processed this reaction
    if (processedReactions.has(reactionId)) {
      logger.info('Reaction already processed, skipping');
      return;
    }

    // Check if the reaction is the trigger emoji
    if (reaction !== TRIGGER_EMOJI) {
      logger.info(`Reaction ${reaction} doesn't match trigger emoji ${TRIGGER_EMOJI}`);
      return;
    }

    // Get channel name to verify it's the onboarding channel
    const channelName = await getChannelName(client, item.channel);

    if (channelName !== ONBOARDING_CHANNEL) {
      logger.info(`Reaction in channel ${channelName}, not ${ONBOARDING_CHANNEL}`);
      return;
    }

    logger.info(`Processing reaction in ${ONBOARDING_CHANNEL} channel`);

    // Mark this reaction as processed
    processedReactions.add(reactionId);

    // Get the message that was reacted to
    const result = await client.conversations.history({
      channel: item.channel,
      latest: item.ts,
      limit: 1,
      inclusive: true
    });

    if (!result.messages || result.messages.length === 0) {
      logger.error('Could not retrieve the message');
      return;
    }

    const message = result.messages[0];
    const userName = await getUserName(client, message.user);
    const messageLink = await getMessageLink(client, item.channel, item.ts);

    // Extract full message text including blocks and attachments
    const fullMessageText = extractMessageText(message);

    // Prepare message data for Jira
    const messageData = {
      text: fullMessageText,
      userName: userName,
      userEmail: message.user, // You might want to get actual email
      messageLink: messageLink,
      timestamp: new Date(parseFloat(item.ts) * 1000).toISOString()
    };

    logger.info('Creating Jira ticket...');

    // Create Jira ticket
    const jiraTicket = await createJiraTicket(messageData);

    const ticketKey = jiraTicket.issueKey || jiraTicket.key;
    logger.info(`Jira ticket created: ${ticketKey}`);

    // Post a confirmation message in the thread
    await client.chat.postMessage({
      channel: item.channel,
      thread_ts: item.ts,
      text: `✅ Jira ticket created: ${process.env.JIRA_BASE_URL}/browse/${ticketKey}`
    });

  } catch (error) {
    logger.error('Error handling reaction:', error);

    // Optionally notify in Slack about the error
    try {
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: `❌ Error creating Jira ticket: ${error.message}`
      });
    } catch (notifyError) {
      logger.error('Error sending error notification:', notifyError);
    }
  }
});

// Start the app
(async () => {
  try {
    await app.start();
    console.log('⚡️ Slack-Jira automation is running!');
    console.log(`Watching for "${TRIGGER_EMOJI}" reactions in #${ONBOARDING_CHANNEL}`);
  } catch (error) {
    console.error('Error starting app:', error);
    process.exit(1);
  }
})();
