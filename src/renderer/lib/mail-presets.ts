import { MailServerConfig, ProviderType } from '../types/index';

type ServerDefaults = Omit<MailServerConfig, 'username'>;

export interface MailPreset {
  label: string;
  passwordHint: string;
  servers: (email: string) => ServerDefaults;
}

function domainOf(email: string): string {
  return email.split('@')[1]?.trim().toLowerCase() ?? '';
}

export const MAIL_PRESETS: Record<ProviderType, MailPreset> = {
  gmail: {
    label: 'Gmail',
    passwordHint:
      'Use a 16-character App Password, not your normal Gmail password. Google Account → Security → 2-Step Verification → App passwords.',
    servers: () => ({ imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 }),
  },
  outlook: {
    label: 'Outlook',
    passwordHint:
      'Microsoft blocks password sign-in for most Outlook / Microsoft 365 accounts, so this may be rejected.',
    servers: () => ({ imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 }),
  },
  custom_imap: {
    label: 'Other (IMAP)',
    passwordHint: 'Your normal mailbox password. Server names usually look like mail.yourdomain.com.',
    servers: (email) => {
      const domain = domainOf(email);
      const host = domain ? `mail.${domain}` : '';
      return { imapHost: host, imapPort: 993, smtpHost: host, smtpPort: 465 };
    },
  },
};
