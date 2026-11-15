const LOGO_ROOT = 'https://logos.composio.dev/api/';

/** Composio toolkit slugs with a real logo on logos.composio.dev. */
export const COMPOSIO_APPS = Object.freeze([
  { id: 'github', name: 'GitHub', detail: 'Repositories, issues, and pull requests.', category: 'Code', popular: true },
  { id: 'gmail', name: 'Gmail', detail: 'Read and draft mail for the agent.', category: 'Mail', popular: true },
  { id: 'slack', name: 'Slack', detail: 'Post into the channels the owner allows.', category: 'Chat', popular: true },
  { id: 'notion', name: 'Notion', detail: 'Read pages the owner has shared.', category: 'Docs', popular: true },
  { id: 'googlecalendar', name: 'Google Calendar', detail: 'See the owner calendar before booking.', category: 'Calendar', popular: true },
  { id: 'linear', name: 'Linear', detail: 'Issues and project updates.', category: 'Code' },
  { id: 'discord', name: 'Discord', detail: 'Messages in the servers the owner allows.', category: 'Chat' },
  { id: 'googledrive', name: 'Google Drive', detail: 'Files the owner has shared.', category: 'Docs' },
  { id: 'outlook', name: 'Outlook', detail: 'Mail on Microsoft 365.', category: 'Mail' },
  { id: 'microsoft_teams', name: 'Microsoft Teams', detail: 'Chat in the teams the owner allows.', category: 'Chat' },
  { id: 'telegram', name: 'Telegram', detail: 'Messages the owner has connected.', category: 'Chat' },
  { id: 'googledocs', name: 'Google Docs', detail: 'Read and draft documents.', category: 'Docs' },
  { id: 'googlesheets', name: 'Google Sheets', detail: 'Spreadsheets the owner has shared.', category: 'Work' },
  { id: 'confluence', name: 'Confluence', detail: 'Wiki pages for the decision loop.', category: 'Docs' },
  { id: 'dropbox', name: 'Dropbox', detail: 'Files the owner has shared.', category: 'Docs' },
  { id: 'airtable', name: 'Airtable', detail: 'Bases the owner has shared.', category: 'Work' },
  { id: 'asana', name: 'Asana', detail: 'Tasks and project status.', category: 'Work' },
  { id: 'todoist', name: 'Todoist', detail: 'The owner task list.', category: 'Work' },
  { id: 'calendly', name: 'Calendly', detail: 'Open times before the agent books.', category: 'Calendar' },
  { id: 'zoom', name: 'Zoom', detail: 'Meetings on the owner account.', category: 'Chat' },
  { id: 'jira', name: 'Jira', detail: 'Issues and sprint status.', category: 'Code' },
  { id: 'gitlab', name: 'GitLab', detail: 'Repositories and merge requests.', category: 'Code' },
  { id: 'sentry', name: 'Sentry', detail: 'Errors worth a look before a change.', category: 'Code' },
  { id: 'supabase', name: 'Supabase', detail: 'Project data the owner connects.', category: 'Code' },
  { id: 'figma', name: 'Figma', detail: 'Files the owner has shared.', category: 'Design' },
  { id: 'stripe', name: 'Stripe', detail: 'Charges and customers. A spend still needs approval.', category: 'Commerce' },
  { id: 'shopify', name: 'Shopify', detail: 'Orders and catalog for the shopper.', category: 'Commerce' },
  { id: 'hubspot', name: 'HubSpot', detail: 'Contacts the owner already keeps.', category: 'Commerce' },
  { id: 'twitter', name: 'X', detail: 'Posts and mentions on X (Twitter).', category: 'Social' },
  { id: 'linkedin', name: 'LinkedIn', detail: 'Profile and messages the owner connects.', category: 'Social' },
  { id: 'reddit', name: 'Reddit', detail: 'Threads for research.', category: 'Research' },
  { id: 'exa', name: 'Exa', detail: 'Search built for agents.', category: 'Research' },
  { id: 'hackernews', name: 'Hacker News', detail: 'Front page and threads.', category: 'Research' },
]);

export function composioLogo(slug) {
  return `${LOGO_ROOT}${slug}`;
}

export function composioConnectors() {
  return COMPOSIO_APPS.map(app => ({
    id: app.id,
    name: app.name,
    detail: app.detail,
    category: app.category,
    popular: Boolean(app.popular),
    builtin: false,
    linked: false,
    composio: true,
    logo: composioLogo(app.id),
  }));
}
