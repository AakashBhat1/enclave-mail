import { useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { SPRING_SNAPPY } from '../../lib/motion';

interface KeywordInputProps {
  keywords: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  label: string;
}

function parse(text: string): string[] {
  return text
    .split(',')
    .map((k) => k.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((k) => k.replace(/^-/, '').trim().length > 0);
}

/** Keyword chips: Enter or comma adds, Backspace on an empty field removes the last one, "-word" excludes. */
export function KeywordInput({ keywords, onChange, placeholder = 'Add keyword…', label }: KeywordInputProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const added = parse(draft).filter((k) => !keywords.includes(k));
    setDraft('');
    if (added.length > 0) onChange([...keywords, ...added]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && keywords.length > 0) {
      onChange(keywords.slice(0, -1));
    }
  };

  return (
    <div className="flex min-h-[34px] flex-wrap items-center gap-1 rounded-lg border border-border bg-surface/80 px-1.5 py-1 transition focus-within:border-sky/60 focus-within:ring-4 focus-within:ring-sky/10">
      <AnimatePresence initial={false}>
        {keywords.map((keyword) => {
          const exclude = keyword.startsWith('-');
          return (
            <motion.span
              key={keyword}
              layout
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={SPRING_SNAPPY}
              className={`chip !py-[3px] ${exclude ? 'border-cranberry/30 bg-cranberry/10 text-cranberry line-through decoration-cranberry/40' : 'border-sky/30 bg-sky/10 text-sky'}`}
              title={exclude ? `Letters mentioning “${keyword.slice(1)}” are kept out of this branch` : `Files letters mentioning “${keyword}”`}
            >
              {keyword}
              <button
                type="button"
                onClick={() => onChange(keywords.filter((k) => k !== keyword))}
                className="-mr-0.5 rounded-full p-0.5 hover:bg-black/10"
                aria-label={`Remove ${keyword}`}
              >
                <X className="size-2.5" />
              </button>
            </motion.span>
          );
        })}
      </AnimatePresence>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={keywords.length === 0 ? placeholder : ''}
        aria-label={label}
        className="min-w-[90px] flex-1 bg-transparent px-1 py-0.5 text-xs text-foreground outline-none placeholder:text-muted/60"
      />
    </div>
  );
}
