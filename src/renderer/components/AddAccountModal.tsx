import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ChevronRight, Database, ShieldCheck } from 'lucide-react';
import { AddAccountInput, IpcResult, MailServerConfig, ProviderEnclave, ProviderType } from '../types/index';
import { MAIL_PRESETS } from '../lib/mail-presets';
import { ServerSettingsFields } from './ServerSettingsFields';
import { Modal, ModalHeader } from './ui/Modal';
import { Pebble } from './ui/Pebble';
import { ACCOUNT_COLORS } from '../lib/avatar';
import { EASE_OUT_EXPO, SPRING_SNAPPY } from '../lib/motion';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProvider: (input: AddAccountInput) => Promise<IpcResult<ProviderEnclave>>;
}

const TYPE_MARK: Record<ProviderType, { glyph: string; color: string }> = {
  gmail: { glyph: 'G', color: '#C4541C' },
  outlook: { glyph: 'O', color: '#3F6C73' },
  custom_imap: { glyph: '@', color: '#5F6B3A' },
};

export function AddAccountModal({ isOpen, onClose, onAddProvider }: AddAccountModalProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const close = () => {
    if (!isConnecting) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} widthClass="max-w-md" labelledBy="add-account-title">
      <AddAccountForm onAddProvider={onAddProvider} onClose={close} onConnectingChange={setIsConnecting} />
    </Modal>
  );
}

interface AddAccountFormProps {
  onAddProvider: AddAccountModalProps['onAddProvider'];
  onClose: () => void;
  onConnectingChange: (connecting: boolean) => void;
}

function Label({ children }: { children: string }) {
  return <span className="mb-1.5 block text-xs font-semibold text-foreground/80">{children}</span>;
}

function OrbitLoader() {
  return (
    <span className="relative size-4">
      <motion.span className="absolute inset-0" animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}>
        <span className="absolute left-1/2 top-0 size-1.5 -translate-x-1/2 rounded-full bg-white" />
        <span className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-white/60" />
      </motion.span>
      <span className="absolute inset-[5px] rounded-full bg-white/80" />
    </span>
  );
}

function AddAccountForm({ onAddProvider, onClose, onConnectingChange }: AddAccountFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [type, setType] = useState<ProviderType>('gmail');
  const [color, setColor] = useState(ACCOUNT_COLORS[0]);
  // null = follow the preset/email automatically; set once the user edits a server field
  const [serverOverride, setServerOverride] = useState<MailServerConfig | null>(null);
  const [showServer, setShowServer] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = MAIL_PRESETS[type];
  const server = serverOverride ?? { username: email.trim(), ...preset.servers(email) };
  const serverVisible = type === 'custom_imap' || showServer;

  // Keep an edited username in step with the email unless the user typed a different one
  const handleEmailChange = (value: string) => {
    if (serverOverride && serverOverride.username === email.trim()) {
      setServerOverride({ ...serverOverride, username: value.trim() });
    }
    setEmail(value);
  };

  const setConnecting = (value: boolean) => {
    setIsConnecting(value);
    onConnectingChange(value);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setConnecting(true);
    const result = await onAddProvider({ name, email, password, type, avatarColor: color, server }).catch(
      (err: unknown): IpcResult<ProviderEnclave> => ({ success: false, error: String(err) })
    );
    setConnecting(false);
    if (!result.success) {
      setError(result.error ?? 'Could not connect to this account.');
      return;
    }
    onClose();
  };

  return (
    <>
      <ModalHeader id="add-account-title" icon={Database} title="Add a mailbox" subtitle="Each account gets its own isolated local enclave." onClose={onClose} />

      <div className="mx-6 mb-1 flex items-start gap-2.5 rounded-2xl border border-sky/20 bg-sky/10 p-3 text-xs leading-relaxed text-sky">
        <ShieldCheck className="mt-0.5 size-4 flex-shrink-0" />
        <span>We sign in to your server before saving. Your password is encrypted by Windows and stays on this PC.</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto px-6 pb-6 pt-4">
        <div>
          <Label>Provider</Label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(MAIL_PRESETS) as ProviderType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t);
                  setServerOverride(null);
                }}
                className={`relative flex flex-col items-center gap-2 rounded-2xl border px-2 py-3 text-xs font-semibold transition-colors ${
                  type === t ? 'border-transparent text-foreground' : 'border-border text-muted hover:border-primary/30 hover:text-foreground'
                }`}
              >
                {type === t && (
                  <motion.span layoutId="provider-ring" className="absolute inset-0 rounded-2xl bg-surface shadow-warm ring-2 ring-primary/60" transition={SPRING_SNAPPY} />
                )}
                <Pebble color={TYPE_MARK[t].color} size={30} className="relative">
                  {TYPE_MARK[t].glyph}
                </Pebble>
                <span className="relative">{MAIL_PRESETS[t].label}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <Label>Display name</Label>
          <input type="text" required placeholder="e.g. ETSPL Team" value={name} onChange={(e) => setName(e.target.value)} className="field" />
        </label>

        <label className="block">
          <Label>Email address</Label>
          <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => handleEmailChange(e.target.value)} className="field" />
        </label>

        <label className="block">
          <Label>Password</Label>
          <input type="password" required autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className="field" />
          <AnimatePresence mode="wait">
            <motion.p
              key={type}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
              className="mt-1.5 text-[11px] leading-relaxed text-muted"
            >
              {preset.passwordHint}
            </motion.p>
          </AnimatePresence>
        </label>

        {type !== 'custom_imap' && (
          <button type="button" onClick={() => setShowServer((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-foreground">
            <ChevronRight className={`size-3.5 transition-transform duration-300 ease-out-expo ${showServer ? 'rotate-90' : ''}`} />
            Server settings
          </button>
        )}
        <AnimatePresence initial={false}>
          {serverVisible && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE_OUT_EXPO }} className="overflow-hidden">
              <ServerSettingsFields server={server} onChange={setServerOverride} />
            </motion.div>
          )}
        </AnimatePresence>

        <div>
          <Label>Avatar colour</Label>
          <div className="flex gap-2.5">
            {ACCOUNT_COLORS.map((c) => (
              <motion.button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.9 }}
                animate={{ scale: color === c ? 1.12 : 1 }}
                transition={SPRING_SNAPPY}
                className={`rounded-full ${color === c ? 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-[rgb(var(--surface))]' : ''}`}
                aria-label={`Colour ${c}`}
              >
                <Pebble color={c} size={28} className="!rounded-full">
                  {' '}
                </Pebble>
              </motion.button>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="flex items-start gap-2 rounded-xl border border-cranberry/25 bg-cranberry/10 p-3 text-xs text-cranberry">
                <AlertTriangle className="mt-0.5 size-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={isConnecting} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={isConnecting} className="btn-primary !px-5 !py-2.5 disabled:!opacity-90">
            {isConnecting && <OrbitLoader />}
            {isConnecting ? 'Signing in…' : 'Connect account'}
          </button>
        </div>
      </form>
    </>
  );
}
