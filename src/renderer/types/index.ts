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
  keywords?: string[]; // Tree Sorter keywords; a leading "-" excludes
}

export interface AssociationNode {
  id: string;
  providerId: string;
  name: string; // e.g. "7brd Core", "Acme Corp", "Stripe Billing"
  position: number; // Custom user-defined position rank
  icon?: string;
  agendas: AgendaNode[];
  keywords?: string[]; // Tree Sorter keywords; a leading "-" excludes (also applies to every agenda below)
  unreadCount?: number;
  totalCount?: number;
}

/** One branch an email was auto-filed into by the Tree Sorter, and the keyword that put it there. */
export interface TreeMatch {
  associationId: string;
  agendaId?: string;
  keyword: string;
}

export type TreeSorterField = 'subject' | 'from' | 'snippet';

export interface TreeSorterSettings {
  folders: string[];
  fields: TreeSorterField[];
  /** 'word' matches at the start of a word ("invoice" hits "Invoices"); 'anywhere' is a plain substring. */
  matchMode: 'word' | 'anywhere';
  /** Re-file automatically after every sync. */
  autoRun: boolean;
}

export interface TreeScanNodeResult {
  associationId: string;
  agendaId?: string;
  count: number;
  unread: number;
  samples: string[];
}

export interface TreeScanReport {
  scanned: number;
  matched: number;
  /** Emails filed into more than one branch. */
  multiBranch: number;
  unmatched: number;
  nodes: TreeScanNodeResult[];
  applied: boolean;
  scannedAt: number;
}

export interface KeywordSuggestion {
  keyword: string;
  /** How many scanned subjects mention it. */
  count: number;
}

export interface TreeSorterState {
  settings: TreeSorterSettings;
  lastScan: TreeScanReport | null;
  /** Frequent subject words not yet used anywhere in the tree. */
  suggestions: KeywordSuggestion[];
}

export type SenderGroupMode = 'sender' | 'domain';

export interface SenderGroup {
  /** Filter id for getEmails, e.g. "sender:ana@acme.com" or "domain:acme.com". */
  id: string;
  label: string;
  address: string;
  count: number;
  unread: number;
  starred: number;
  latestTimestamp: number;
  latestSubject: string;
  /** Distinct senders inside a domain group. */
  members: number;
}

/** Sent by the main process after it repaired a damaged data file; `file` is the file name only. */
export interface StorageRecoveryNotice {
  file: string;
  outcome: 'restored' | 'reset';
}

export interface SyncProgress {
  providerId: string;
  /** 'history' while older mail is still downloading, 'done' once everything is local, 'stopped' after a failure (the next sync resumes). */
  phase: 'history' | 'done' | 'stopped';
  done: number;
  total: number;
  folderId?: string;
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
  bodyText?: string; // Only on getEmailDetail; lists carry headers only
  bodyHtml?: string;
  /** Very large letters are stored partially during history download. */
  bodyTruncated?: boolean;
  isRead: boolean;
  isStarred: boolean;
  tags: string[];
  attachments: Attachment[];
  /** Tree Sorter branches, attached when read (not stored on the message). */
  treeMatches?: TreeMatch[];
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
  /** Folders whose read/star state syncs both ways; a folder's first such sync keeps local reads/stars and sends them. */
  twoWayFolders?: string[];
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
    // Moving mail waits for a real IMAP MOVE (a local move would be undone by the next sync)
    type: 'applyTag' | 'exportMarkdown';
    targetValue: string;
  };
}

/** What "Run mod" did to one letter. */
export interface ModRunResult {
  appliedMods: string[];
  tagsAdded: string[];
  /** Markdown files written under ~/EnclaveMail/exports. */
  exported: string[];
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
