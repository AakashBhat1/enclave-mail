import { useState } from 'react';
import { motion } from 'motion/react';
import { Check, X } from 'lucide-react';
import { EASE_OUT_EXPO } from '../../lib/motion';

interface InlineAddFormProps {
  placeholder: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Small inline "name it" form that unfolds in place (used for new associations and agendas). */
export function InlineAddForm({ placeholder, onSubmit, onCancel }: InlineAddFormProps) {
  const [value, setValue] = useState('');

  return (
    <motion.form
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
      className="overflow-hidden"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit(value.trim());
        setValue('');
      }}
    >
      <div className="flex items-center gap-1.5 p-1.5">
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
          className="field !rounded-lg !px-2.5 !py-1.5 !text-xs"
          autoFocus
        />
        <button type="submit" className="grid size-7 flex-shrink-0 place-items-center rounded-lg bg-primary text-white shadow-warm transition-transform hover:scale-105" aria-label="Add">
          <Check className="size-3.5" />
        </button>
        <button type="button" onClick={onCancel} className="icon-btn !size-7 flex-shrink-0" aria-label="Cancel">
          <X className="size-3.5" />
        </button>
      </div>
    </motion.form>
  );
}
