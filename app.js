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
 * Get Service Desk and Request Type IDs
 */
async function getServiceDeskRequestType() {
  const authHeader = `Basic ${Buffer.from(
    `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
  ).toString('base64')}`;

  try {
    // Get all service desks
    console.log('Fetching service desks...');
    const serviceDesksResponse = await axios.get(
      `${process.env.JIRA_BASE_URL}/rest/servicedeskapi/servicedesk`,
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Service desks found:', serviceDesksResponse.data.values?.length || 0);

    // Find the service desk matching our project key
    const serviceDesk = serviceDesksResponse.data.values?.find(
      sd => sd.projectKey === JIRA_PROJECT_KEY
    );

    if (!serviceDesk) {
      console.error(`No Service Desk found for project ${JIRA_PROJECT_KEY}`);
      return null;
    }

    console.log(`Found Service Desk: ${serviceDesk.projectName} (ID: ${serviceDesk.id})`);

    // Get request types for this service desk
    console.log('Fetching request types...');
    const requestTypesResponse = await axios.get(
      `${process.env.JIRA_BASE_URL}/rest/servicedeskapi/servicedesk/${serviceDesk.id}/requesttype`,
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Request types available:');
    requestTypesResponse.data.values?.forEach(rt => {
      console.log(`  - ${rt.name} (ID: ${rt.id})`);
    });

    // Find "New Hire Onboarding" request type
    const requestType = requestTypesResponse.data.values?.find(
      rt => rt.name.toLowerCase().includes('new hire onboarding')
    );

    if (requestType) {
      console.log(`Found matching request type: ${requestType.name} (ID: ${requestType.id})`);

      // Get fields for this request type
      console.log('Fetching fields for request type...');
      const fieldsResponse = await axios.get(
        `${process.env.JIRA_BASE_URL}/rest/servicedeskapi/servicedesk/${serviceDesk.id}/requesttype/${requestType.id}/field`,
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('Available fields for New Hire Onboarding:');
      const requestTypeFields = fieldsResponse.data.requestTypeFields || [];
      requestTypeFields.forEach(field => {
        console.log(`  - ${field.fieldId}: ${field.name} (required: ${field.required})`);
      });

      return {
        serviceDeskId: serviceDesk.id,
        requestTypeId: requestType.id,
        requestTypeName: requestType.name,
        fields: requestTypeFields
      };
    }

    console.error('New Hire Onboarding request type not found');
    return null;
  } catch (error) {
    console.error('Error fetching Service Desk info:');
    console.error('Status:', error.response?.status);
    console.error('Error:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Get field metadata for creating an issue
 */
async function getIssueCreateMetadata() {
  const metadataUrl = `${process.env.JIRA_BASE_URL}/rest/api/2/issue/createmeta?projectKeys=${JIRA_PROJECT_KEY}&issuetypeNames=${encodeURIComponent(JIRA_ISSUE_TYPE)}&expand=projects.issuetypes.fields`;

  try {
    const response = await axios.get(metadataUrl, {
      headers: {
        'Authorization': `Basic ${Buffer.from(
          `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
        ).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });

    const project = response.data.projects?.[0];
    const issueType = project?.issuetypes?.[0];
    const fields = issueType?.fields || {};

    return fields;
  } catch (error) {
    console.error('Error fetching issue metadata:', error.response?.data || error.message);
    return {};
  }
}

/**
 * Parse Rippling message to extract employee details
 */
function parseRipplingMessage(text) {
  const details = {};

  // Common patterns in Rippling messages
  const patterns = {
    name: /New Hire:\s*(.+?)(?:\n|$)/i,
    preferredName: /Preferred Name:\s*(.+?)(?:\n|$)/i,
    startDate: /Start Date:\s*(.+?)(?:\n|$)/i,
    title: /Title:\s*(.+?)(?:\n|$)/i,
    department: /Department:\s*(.+?)(?:\n|$)/i,
    manager: /Manager:\s*(.+?)(?:\n|$)/i,
    employmentType: /Employment Type:\s*(.+?)(?:\n|$)/i,
    workLocation: /Work Location:\s*(.+?)(?:\n|$)/i,
    email: /Email:\s*(.+?)(?:\n|$)/i,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match) {
      details[key] = match[1].trim();
    }
  }

  return details;
}

/**
 * Map parsed employee details to Jira custom fields
 */
function mapDetailsToJiraFields(details, fieldMetadata) {
  const mappedFields = {};

  // Common field name mappings to look for in Jira
  const fieldMappings = {
    name: ['Name', 'Employee Name', 'Full Name'],
    startDate: ['Start Date', 'Start date', 'Employment Start Date'],
    email: ['Email', 'Email Address'],
    department: ['Department'],
    manager: ['Manager', 'Manager Information'],
    employmentType: ['Employment Type'],
  };

  // Find matching custom fields by name
  for (const [detailKey, value] of Object.entries(details)) {
    if (!value) continue;

    const possibleNames = fieldMappings[detailKey] || [detailKey];

    for (const [fieldId, fieldInfo] of Object.entries(fieldMetadata)) {
      const fieldName = fieldInfo.name;

      if (possibleNames.some(name => fieldName.toLowerCase().includes(name.toLowerCase()))) {
        // Handle different field types
        if (fieldInfo.schema?.type === 'date') {
          // Try to parse and format date
          mappedFields[fieldId] = formatDateForJira(value);
        } else if (fieldInfo.schema?.type === 'user') {
          // For user fields, we'd need to look up the user - skip for now
          continue;
        } else {
          // Plain text field
          mappedFields[fieldId] = value;
        }
        break;
      }
    }
  }

  return mappedFields;
}

/**
 * Format date string to Jira format (YYYY-MM-DD)
 */
function formatDateForJira(dateString) {
  try {
    // Handle common formats like "12/1/25", "12/01/2025", etc.
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (error) {
    console.error('Error parsing date:', error);
  }
  return dateString; // Return original if parsing fails
}

/**
 * Create a Jira ticket using standard API or Service Desk API
 */
async function createJiraTicket(messageData) {
  const authHeader = `Basic ${Buffer.from(
    `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
  ).toString('base64')}`;

  // Prepare description text
  const description = `Onboarding request from Slack:\n\n${messageData.text}\n\nRequested by: ${messageData.userName}\n\nSlack Message Link: ${messageData.messageLink}`;

  // Try Service Desk API first if using "New Hire Onboarding"
  if (JIRA_ISSUE_TYPE === 'New Hire Onboarding') {
    console.log('Attempting to use Service Desk API...');
    const serviceDeskInfo = await getServiceDeskRequestType();

    if (serviceDeskInfo) {
      // Parse employee details
      const parsedDetails = parseRipplingMessage(messageData.text);
      console.log('Parsed employee details:', JSON.stringify(parsedDetails, null, 2));

      // Map parsed details to Service Desk fields
      const requestFieldValues = {};
      const fields = serviceDeskInfo.fields || [];

      // Map employee details to fields
      fields.forEach(field => {
        const fieldName = field.name.toLowerCase();

        if (fieldName.includes('summary')) {
          requestFieldValues[field.fieldId] = parsedDetails.name
            ? `Onboarding: ${parsedDetails.name}`
            : `Onboarding Request - ${new Date().toLocaleDateString()}`;
        } else if (fieldName.includes('priority')) {
          // Set default priority to "Low" or the first available option
          requestFieldValues[field.fieldId] = { name: 'Low' };
        } else if (fieldName.includes('name') && !fieldName.includes('manager')) {
          if (parsedDetails.name) {
            requestFieldValues[field.fieldId] = parsedDetails.name;
          }
        } else if (fieldName.includes('start date')) {
          if (parsedDetails.startDate) {
            // Format date to yyyy-MM-dd
            requestFieldValues[field.fieldId] = formatDateForJira(parsedDetails.startDate);
          }
        } else if (fieldName.includes('email')) {
          if (parsedDetails.email) {
            requestFieldValues[field.fieldId] = parsedDetails.email;
          }
        } else if (fieldName.includes('department')) {
          if (parsedDetails.department) {
            requestFieldValues[field.fieldId] = parsedDetails.department;
          }
        } else if (fieldName.includes('manager')) {
          if (parsedDetails.manager) {
            requestFieldValues[field.fieldId] = parsedDetails.manager;
          }
        } else if (fieldName.includes('title') || fieldName.includes('position')) {
          if (parsedDetails.title) {
            requestFieldValues[field.fieldId] = parsedDetails.title;
          }
        } else if (fieldName.includes('employment type')) {
          if (parsedDetails.employmentType) {
            requestFieldValues[field.fieldId] = parsedDetails.employmentType;
          }
        } else if (fieldName.includes('location')) {
          if (parsedDetails.workLocation) {
            requestFieldValues[field.fieldId] = parsedDetails.workLocation;
          }
        } else if (fieldName.includes('description') || fieldName.includes('details')) {
          // Only add description if the field exists
          requestFieldValues[field.fieldId] = description;
        }
      });

      // Don't add Slack link to summary - keep it single line
      // The summary field in Service Desk doesn't support newlines

      // Create Service Desk request
      const requestData = {
        serviceDeskId: serviceDeskInfo.serviceDeskId,
        requestTypeId: serviceDeskInfo.requestTypeId,
        requestFieldValues: requestFieldValues
      };

      console.log('Creating Service Desk request:', JSON.stringify(requestData, null, 2));

      try {
        const response = await axios.post(
          `${process.env.JIRA_BASE_URL}/rest/servicedeskapi/request`,
          requestData,
          {
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
          }
        );

        console.log('Successfully created Service Desk request!');
        return response.data;
      } catch (sdError) {
        console.error('Service Desk API failed:');
        console.error('Status:', sdError.response?.status);
        console.error('Error:', JSON.stringify(sdError.response?.data, null, 2));
        console.log('Falling back to regular Jira API with Task type...');
      }
    } else {
      console.log('Could not get Service Desk info, falling back to Task type...');
    }
  }

  // Fallback: Use regular Jira API with Task type
  const jiraUrl = `${process.env.JIRA_BASE_URL}/rest/api/2/issue`;

  // Get field metadata for the issue type
  const fieldMetadata = await getIssueCreateMetadata();

  // Log available fields for debugging
  console.log('Available Jira fields for', JIRA_ISSUE_TYPE, ':');
  Object.entries(fieldMetadata).forEach(([fieldId, fieldInfo]) => {
    console.log(`  ${fieldId}: ${fieldInfo.name} (${fieldInfo.schema?.type || 'unknown type'})`);
  });

  // Parse Rippling message if it looks like a Rippling notification
  let customFields = {};
  if (messageData.text.includes('New Hire:') || messageData.text.includes('Start Date:')) {
    console.log('Detected Rippling message, parsing employee details...');
    const parsedDetails = parseRipplingMessage(messageData.text);
    console.log('Parsed details:', JSON.stringify(parsedDetails, null, 2));

    customFields = mapDetailsToJiraFields(parsedDetails, fieldMetadata);
    console.log('Mapped to Jira fields:', JSON.stringify(customFields, null, 2));
  }

  // Prepare the issue data
  const issueData = {
    fields: {
      project: {
        key: JIRA_PROJECT_KEY
      },
      summary: customFields.name
        ? `Onboarding: ${customFields.name}`
        : `Onboarding Request - ${new Date().toLocaleDateString()}`,
      description: description,
      issuetype: {
        name: JIRA_ISSUE_TYPE
      },
      ...customFields
    }
  };

  // Add custom fields from environment if configured
  if (process.env.JIRA_CUSTOM_FIELDS) {
    try {
      const envCustomFields = JSON.parse(process.env.JIRA_CUSTOM_FIELDS);
      Object.assign(issueData.fields, envCustomFields);
    } catch (error) {
      console.error('Error parsing JIRA_CUSTOM_FIELDS:', error);
    }
  }

  console.log('Creating Jira ticket with fields (Task type):', JSON.stringify(issueData, null, 2));

  try {
    const response = await axios.post(jiraUrl, issueData, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    });

    console.log('Successfully created ticket as Task type');
    return response.data;
  } catch (error) {
    console.error('Error creating Jira ticket with Task type:');
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
