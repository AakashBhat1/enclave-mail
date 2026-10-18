import React from 'react';
import { MailServerConfig } from '../types/index';

interface ServerSettingsFieldsProps {
  server: MailServerConfig;
  onChange: (server: MailServerConfig) => void;
}

const labelClass = 'mb-1 block text-[11px] font-semibold text-muted';

export function ServerSettingsFields({ server, onChange }: ServerSettingsFieldsProps) {
  const set = <K extends keyof MailServerConfig>(key: K, value: MailServerConfig[K]) => onChange({ ...server, [key]: value });
  const setPort = (key: 'imapPort' | 'smtpPort', raw: string) => set(key, Number.parseInt(raw, 10) || 0);

  return (
    <div className="space-y-2.5 rounded-2xl border border-border/80 bg-sunken/50 p-3.5">
      <div>
        <label className={labelClass}>Username</label>
        <input type="text" required value={server.username} onChange={(e) => set('username', e.target.value)} className="field" />
      </div>
      <div className="grid grid-cols-[1fr_5.5rem] gap-2">
        <div>
          <label className={labelClass}>Incoming server (IMAP)</label>
          <input type="text" required value={server.imapHost} onChange={(e) => set('imapHost', e.target.value)} className="field" />
        </div>
        <div>
          <label className={labelClass}>Port</label>
          <input type="number" required value={server.imapPort || ''} onChange={(e) => setPort('imapPort', e.target.value)} className="field" />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_5.5rem] gap-2">
        <div>
          <label className={labelClass}>Outgoing server (SMTP)</label>
          <input type="text" required value={server.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} className="field" />
        </div>
        <div>
          <label className={labelClass}>Port</label>
          <input type="number" required value={server.smtpPort || ''} onChange={(e) => setPort('smtpPort', e.target.value)} className="field" />
        </div>
      </div>
      <p className="text-[11px] text-muted">IMAP 993 and SMTP 465 use SSL. Ports 143 and 587 upgrade with STARTTLS.</p>
    </div>
  );
}
