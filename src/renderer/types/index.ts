export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  downloadUrl?: string;
}

export interface AgendaNode {
  id: string;
  name: string; // e.g. "Project", "Financial", "Project Financial", "Legal"
  category: 'project' | 'financial' | 'operations' | 'legal' | 'custom';
  position: number;
  unreadCount: number;
  totalCount: number;
}

export interface AssociationNode {
  id: string;
  providerId: string;
  name: string; // e.g. "7brd Core", "Acme Corp", "Stripe Billing"
  position: number; // Custom user-defined position rank
  icon?: string;
  agendas: AgendaNode[];
}

export interface EmailMessage {
  id: string;
  providerId: string;
  folderId: string;
  associationId?: string; // Links to AssociationNode (e.g. "assoc_7brd")
  agendaId?: string; // Links to AgendaNode (e.g. "agenda_proj_fin")
  position?: number; // Custom user-defined position rank within the agenda/association/folder
  from: {
    name: string;
    address: string;
  };
  to: {
    name: string;
    address: string;
  }[];
  subject: string;
  date: string;
  timestamp?: number; // Epoch ms, used for newest-first ordering
  uid?: number; // IMAP UID within the server mailbox
  messageId?: string; // RFC 5322 Message-ID, used to match local sent copies to server copies
  snippet: string;
  bodyText?: string;
  bodyHtml?: string;
  isRead: boolean;
  isStarred: boolean;
  tags: string[];
  attachments: Attachment[];
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  unreadCount: number;
  totalCount: number;
  iconName?: string;
}

export interface ProviderEnclave {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  type: 'gmail' | 'outlook' | 'custom_imap';
  unreadTotal: number;
  storagePath: string;
  server?: MailServerConfig;
  lastSyncedAt?: number;
  status: 'connected' | 'syncing' | 'offline' | 'mock';
}

export type ProviderType = ProviderEnclave['type'];

// Non-secret connection settings; the password lives only in the encrypted credential store
export interface MailServerConfig {
  username: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface AddAccountInput {
  name: string;
  email: string;
  avatarColor: string;
  type: ProviderType;
  server: MailServerConfig;
  password: string;
}

export interface SendEmailInput {
  providerId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
}

export interface SendOutcome {
  messageId: string;
  warning?: string;
  /** The SMTP server's final reply, e.g. "250 OK id=1vAbc-000123-Xy". */
  serverResponse?: string;
}

export interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ModRule {
  id: string;
  name: string;
  enabled: boolean;
  providerId: string;
  condition: {
    field: 'subject' | 'from' | 'body';
    operator: 'contains' | 'equals' | 'startsWith';
    value: string;
  };
  action: {
    type: 'applyTag' | 'moveToFolder' | 'saveAttachment' | 'exportMarkdown';
    targetValue: string;
  };
}

export interface ComposerState {
  isOpen: boolean;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  providerId: string;
  attachments: File[];
  isSending: boolean;
}
