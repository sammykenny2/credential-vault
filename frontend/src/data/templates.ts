/**
 * Built-in Credential Templates
 *
 * Pre-defined templates for common credential types.
 * These templates cannot be edited or deleted by users.
 */

import type { CredentialTemplate, TemplateCategory } from '@/types/template'

// =============================================================================
// Helper function
// =============================================================================

const createBuiltInTemplate = (
  category: TemplateCategory,
  name: string,
  icon: string,
  fields: CredentialTemplate['fields'],
  description?: string
): CredentialTemplate => ({
  id: `builtin-${category}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
  name,
  description,
  icon,
  category,
  fields,
  isBuiltIn: true,
})

// =============================================================================
// Login Templates
// =============================================================================

const loginTemplates: CredentialTemplate[] = [
  createBuiltInTemplate(
    'login',
    'Login (Basic)',
    '🔐',
    [
      { key: 'Username', placeholder: 'Enter username', isSecret: false, required: true },
      { key: 'Password', placeholder: 'Enter password', isSecret: true, required: true },
    ],
    'Basic username and password login'
  ),
  createBuiltInTemplate(
    'login',
    'Login (Email)',
    '📧',
    [
      { key: 'Email', placeholder: 'user@example.com', isSecret: false, required: true, validation: 'email' },
      { key: 'Password', placeholder: 'Enter password', isSecret: true, required: true },
    ],
    'Email-based login credentials'
  ),
  createBuiltInTemplate(
    'login',
    'Login (Banking)',
    '🏦',
    [
      { key: 'Username', placeholder: 'Account ID or username', isSecret: false, required: true },
      { key: 'Password', placeholder: 'Enter password', isSecret: true, required: true },
      { key: 'PIN', placeholder: '4-6 digit PIN', isSecret: true },
      { key: 'Security Questions', placeholder: 'Q&A for account recovery', isSecret: false },
    ],
    'Banking and financial account login'
  ),
]

// =============================================================================
// Google Templates
// =============================================================================

const googleTemplates: CredentialTemplate[] = [
  createBuiltInTemplate(
    'google',
    'Google Account',
    '🔵',
    [
      { key: 'Email', placeholder: 'user@gmail.com', isSecret: false, required: true, validation: 'email' },
      { key: 'Password', placeholder: 'Enter password', isSecret: true, required: true },
      { key: 'Recovery Email', placeholder: 'recovery@example.com', isSecret: false, validation: 'email' },
      { key: 'Recovery Phone', placeholder: '+1234567890', isSecret: false },
    ],
    'Personal Google/Gmail account'
  ),
  createBuiltInTemplate(
    'google',
    'Google OAuth',
    '🔑',
    [
      { key: 'Client ID', placeholder: 'xxx.apps.googleusercontent.com', isSecret: false, required: true },
      { key: 'Client Secret', placeholder: 'GOCSPX-xxxxxx', isSecret: true, required: true },
      { key: 'Redirect URI', placeholder: 'https://example.com/callback', isSecret: false, validation: 'url' },
    ],
    'Google OAuth 2.0 client credentials'
  ),
  createBuiltInTemplate(
    'google',
    'Google API Key',
    '🗝️',
    [
      { key: 'API Key', placeholder: 'AIzaSy...', isSecret: true, required: true },
      { key: 'Project ID', placeholder: 'my-project-123', isSecret: false },
    ],
    'Google Cloud API key'
  ),
  createBuiltInTemplate(
    'google',
    'Google Service Account',
    '🤖',
    [
      { key: 'Client Email', placeholder: 'service@project.iam.gserviceaccount.com', isSecret: false, required: true, validation: 'email' },
      { key: 'Private Key', placeholder: '-----BEGIN PRIVATE KEY-----', isSecret: true, required: true },
      { key: 'Project ID', placeholder: 'my-project-123', isSecret: false, required: true },
    ],
    'Google Cloud service account credentials'
  ),
]

// =============================================================================
// Development Templates
// =============================================================================

const developmentTemplates: CredentialTemplate[] = [
  createBuiltInTemplate(
    'development',
    'API Keys',
    '🔐',
    [
      { key: 'API Key', placeholder: 'Enter API key', isSecret: true, required: true },
      { key: 'API Secret', placeholder: 'Enter API secret', isSecret: true },
    ],
    'Generic API key and secret pair'
  ),
  createBuiltInTemplate(
    'development',
    'OAuth 2.0',
    '🎫',
    [
      { key: 'Client ID', placeholder: 'Enter client ID', isSecret: false, required: true },
      { key: 'Client Secret', placeholder: 'Enter client secret', isSecret: true, required: true },
      { key: 'Scope', placeholder: 'read write (space-separated)', isSecret: false },
    ],
    'OAuth 2.0 client credentials'
  ),
  createBuiltInTemplate(
    'development',
    'SSH Key',
    '🔒',
    [
      { key: 'Username', placeholder: 'SSH username', isSecret: false, required: true },
      { key: 'Host', placeholder: 'server.example.com', isSecret: false, required: true },
      { key: 'Private Key', placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----', isSecret: true, required: true },
      { key: 'Passphrase', placeholder: 'Key passphrase (if any)', isSecret: true },
    ],
    'SSH key for server access'
  ),
  createBuiltInTemplate(
    'development',
    'Database',
    '🗄️',
    [
      { key: 'Host', placeholder: 'localhost or db.example.com', isSecret: false, required: true },
      { key: 'Port', placeholder: '5432', isSecret: false, validation: 'port' },
      { key: 'Database', placeholder: 'mydb', isSecret: false, required: true },
      { key: 'Username', placeholder: 'db_user', isSecret: false, required: true },
      { key: 'Password', placeholder: 'Enter password', isSecret: true, required: true },
    ],
    'Database connection credentials'
  ),
  createBuiltInTemplate(
    'development',
    'GitHub Token',
    '🐙',
    [
      { key: 'Username', placeholder: 'GitHub username', isSecret: false },
      { key: 'Personal Access Token', placeholder: 'ghp_xxxx or github_pat_xxxx', isSecret: true, required: true },
    ],
    'GitHub personal access token'
  ),
  createBuiltInTemplate(
    'development',
    'npm Token',
    '📦',
    [
      { key: 'Token', placeholder: 'npm_xxxx', isSecret: true, required: true },
      { key: 'Registry', placeholder: 'https://registry.npmjs.org', isSecret: false, validation: 'url' },
    ],
    'npm registry authentication token'
  ),
  createBuiltInTemplate(
    'development',
    'Discord Bot',
    '🎮',
    [
      { key: 'Bot Token', placeholder: 'MTxxxx.xxxxx.xxxxx', isSecret: true, required: true },
      { key: 'Client ID', placeholder: '123456789012345678', isSecret: false, required: true },
      { key: 'Client Secret', placeholder: 'Enter client secret', isSecret: true },
    ],
    'Discord bot credentials'
  ),
  createBuiltInTemplate(
    'development',
    'Telegram App',
    '✈️',
    [
      { key: 'API ID', placeholder: '1234567', isSecret: false, required: true },
      { key: 'API Hash', placeholder: '0123456789abcdef0123456789abcdef', isSecret: true, required: true },
      { key: 'Session String', placeholder: 'Pyrogram/Telethon session string', isSecret: true },
    ],
    'Telegram API application credentials'
  ),
]

// =============================================================================
// Cloud Provider Templates
// =============================================================================

const cloudTemplates: CredentialTemplate[] = [
  createBuiltInTemplate(
    'cloud',
    'AWS Credentials',
    '☁️',
    [
      { key: 'Access Key ID', placeholder: 'AKIAIOSFODNN7EXAMPLE', isSecret: false, required: true },
      { key: 'Secret Access Key', placeholder: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', isSecret: true, required: true },
      { key: 'Region', placeholder: 'us-east-1', isSecret: false },
    ],
    'AWS IAM access keys'
  ),
  createBuiltInTemplate(
    'cloud',
    'Azure Service Principal',
    '🔷',
    [
      { key: 'Tenant ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', isSecret: false, required: true },
      { key: 'Client ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', isSecret: false, required: true },
      { key: 'Client Secret', placeholder: 'Enter client secret', isSecret: true, required: true },
    ],
    'Azure AD service principal credentials'
  ),
  createBuiltInTemplate(
    'cloud',
    'DigitalOcean Token',
    '🌊',
    [
      { key: 'API Token', placeholder: 'dop_v1_xxxx', isSecret: true, required: true },
    ],
    'DigitalOcean personal access token'
  ),
]

// =============================================================================
// Network Templates
// =============================================================================

const networkTemplates: CredentialTemplate[] = [
  createBuiltInTemplate(
    'network',
    'WiFi',
    '📶',
    [
      { key: 'Network Name (SSID)', placeholder: 'MyWiFi', isSecret: false, required: true },
      { key: 'Password', placeholder: 'WiFi password', isSecret: true, required: true },
      { key: 'Security Type', placeholder: 'WPA2/WPA3', isSecret: false },
    ],
    'WiFi network credentials'
  ),
  createBuiltInTemplate(
    'network',
    'Server',
    '🖥️',
    [
      { key: 'Host', placeholder: 'server.example.com', isSecret: false, required: true },
      { key: 'Port', placeholder: '22', isSecret: false, validation: 'port' },
      { key: 'Username', placeholder: 'admin', isSecret: false, required: true },
      { key: 'Password', placeholder: 'Enter password', isSecret: true },
      { key: 'SSH Key', placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----', isSecret: true },
    ],
    'Server access credentials'
  ),
  createBuiltInTemplate(
    'network',
    'VPN',
    '🛡️',
    [
      { key: 'Server', placeholder: 'vpn.example.com', isSecret: false, required: true },
      { key: 'Username', placeholder: 'vpn_user', isSecret: false, required: true },
      { key: 'Password', placeholder: 'Enter password', isSecret: true, required: true },
      { key: 'Pre-shared Key', placeholder: 'PSK if required', isSecret: true },
    ],
    'VPN connection credentials'
  ),
]

// =============================================================================
// Financial Templates
// =============================================================================

const financialTemplates: CredentialTemplate[] = [
  createBuiltInTemplate(
    'financial',
    'Credit Card',
    '💳',
    [
      { key: 'Cardholder Name', placeholder: 'John Doe', isSecret: false, required: true },
      { key: 'Card Number', placeholder: '4111 1111 1111 1111', isSecret: true, required: true },
      { key: 'Expiry', placeholder: 'MM/YY', isSecret: false, required: true },
      { key: 'CVV', placeholder: '123', isSecret: true, required: true },
    ],
    'Credit or debit card details'
  ),
  createBuiltInTemplate(
    'financial',
    'Bank Account',
    '🏧',
    [
      { key: 'Bank Name', placeholder: 'Bank of Example', isSecret: false, required: true },
      { key: 'Account Number', placeholder: '1234567890', isSecret: true, required: true },
      { key: 'Routing Number', placeholder: '123456789', isSecret: false },
      { key: 'Account Type', placeholder: 'Checking/Savings', isSecret: false },
    ],
    'Bank account details'
  ),
]

// =============================================================================
// Other Templates
// =============================================================================

const otherTemplates: CredentialTemplate[] = [
  createBuiltInTemplate(
    'other',
    'Microsoft Account',
    '🪟',
    [
      { key: 'Email', placeholder: 'user@outlook.com', isSecret: false, required: true, validation: 'email' },
      { key: 'Password', placeholder: 'Enter password', isSecret: true, required: true },
      { key: 'Recovery Email', placeholder: 'recovery@example.com', isSecret: false, validation: 'email' },
    ],
    'Microsoft/Outlook/Xbox account'
  ),
  createBuiltInTemplate(
    'other',
    'Apple ID',
    '🍎',
    [
      { key: 'Apple ID', placeholder: 'user@icloud.com', isSecret: false, required: true, validation: 'email' },
      { key: 'Password', placeholder: 'Enter password', isSecret: true, required: true },
      { key: 'Recovery Key', placeholder: '28-character recovery key', isSecret: true },
    ],
    'Apple ID / iCloud account'
  ),
  createBuiltInTemplate(
    'other',
    'Software License',
    '📜',
    [
      { key: 'Product Name', placeholder: 'Software name', isSecret: false, required: true },
      { key: 'License Key', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', isSecret: true, required: true },
      { key: 'Email', placeholder: 'Registered email', isSecret: false, validation: 'email' },
    ],
    'Software license key'
  ),
  createBuiltInTemplate(
    'other',
    'Membership',
    '🎫',
    [
      { key: 'Organization', placeholder: 'Gym, Club, etc.', isSecret: false, required: true },
      { key: 'Member ID', placeholder: 'Membership number', isSecret: false, required: true },
      { key: 'PIN', placeholder: 'Access PIN if any', isSecret: true },
    ],
    'Membership or loyalty card'
  ),
]

// =============================================================================
// Exports
// =============================================================================

/**
 * All built-in templates grouped by category.
 */
export const BUILTIN_TEMPLATES_BY_CATEGORY: Record<TemplateCategory, CredentialTemplate[]> = {
  login: loginTemplates,
  google: googleTemplates,
  development: developmentTemplates,
  cloud: cloudTemplates,
  network: networkTemplates,
  financial: financialTemplates,
  other: otherTemplates,
}

/**
 * All built-in templates as a flat array.
 */
export const BUILTIN_TEMPLATES: CredentialTemplate[] = [
  ...loginTemplates,
  ...googleTemplates,
  ...developmentTemplates,
  ...cloudTemplates,
  ...networkTemplates,
  ...financialTemplates,
  ...otherTemplates,
]

/**
 * Category display names for UI.
 */
export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  login: 'Login',
  google: 'Google',
  development: 'Development',
  cloud: 'Cloud',
  network: 'Network',
  financial: 'Financial',
  other: 'Other',
}

/**
 * Category display order in UI.
 */
export const CATEGORY_ORDER: TemplateCategory[] = [
  'login',
  'google',
  'development',
  'cloud',
  'network',
  'financial',
  'other',
]

/**
 * Get a built-in template by ID.
 */
export function getBuiltInTemplate(id: string): CredentialTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id)
}

/**
 * Check if a template ID belongs to a built-in template.
 */
export function isBuiltInTemplateId(id: string): boolean {
  return id.startsWith('builtin-')
}
