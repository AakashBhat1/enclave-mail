import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { MailServerConfig } from '../../renderer/types/index';

const IMPLICIT_TLS_PORT = 465;
// nodemailer's defaults (2 min connect, 10 min socket) leave a send hanging far too long on a dead server
const CONNECTION_TIMEOUT_MS = 15_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 60_000;

// These providers file SMTP-sent mail into Sent themselves; appending again would duplicate it
const AUTO_SAVES_SENT = [/\.gmail\.com$/i, /\.googlemail\.com$/i, /\.office365\.com$/i, /\.outlook\.com$/i];

export interface SendReceipt {
  messageId: string;
  raw: Buffer;
  /** The server's final reply, e.g. "250 OK id=1vAbc-000123-Xy" — the id is what the host's delivery log uses. */
  serverResponse: string;
  rejected: string[];
}

export interface OutgoingMail {
  from: { name: string; address: string };
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html: string;
}

function createTransport(config: MailServerConfig, password: string) {
  const implicitTls = config.smtpPort === IMPLICIT_TLS_PORT;
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: implicitTls,
    // On 587/25 refuse to send credentials unless the server upgrades to TLS
    requireTLS: !implicitTls,
    auth: { user: config.username, pass: password },
    tls: { rejectUnauthorized: true },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

export class SmtpService {
  public static async verify(config: MailServerConfig, password: string): Promise<void> {
    await createTransport(config, password).verify();
  }

  public static serverSavesSentCopy(config: MailServerConfig): boolean {
    return AUTO_SAVES_SENT.some((pattern) => pattern.test(config.smtpHost));
  }

  // Returns the raw MIME message so the caller can store an identical copy in the Sent folder
  public static async send(config: MailServerConfig, password: string, mail: OutgoingMail): Promise<SendReceipt> {
    const domain = mail.from.address.split('@')[1] || 'localhost';
    const messageId = `<${randomUUID()}@${domain}>`;
    const node = new MailComposer({
      messageId,
      from: mail.from,
      to: mail.to,
      cc: mail.cc,
      // Bcc lands only in the envelope; MailComposer strips the header from the built message
      bcc: mail.bcc,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }).compile();
    const raw = await node.build();

    // getEnvelope parses quoted names like "Doe, John" <j@x.com> correctly
    const info = await createTransport(config, password).sendMail({ envelope: node.getEnvelope(), raw });
    const rejected = (info.rejected ?? []).map((r) => (typeof r === 'string' ? r : r.address));
    return { messageId, raw, serverResponse: info.response ?? '', rejected };
  }
}
