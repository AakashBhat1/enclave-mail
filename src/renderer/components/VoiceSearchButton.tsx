import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Mic, Sparkles, Cpu } from 'lucide-react';
import { EASE_OUT_EXPO } from '../lib/motion';

interface VoiceSearchButtonProps {
  onTranscript: (query: string) => void;
  onVoiceCommand?: (command: { type: 'filter' | 'folder' | 'clear'; value: string }) => void;
}

export const VoiceSearchButton: React.FC<VoiceSearchButtonProps> = ({
  onTranscript,
  onVoiceCommand,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showVoiceHUD, setShowVoiceHUD] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Check for Web Speech API (supported natively in Chromium/Electron)
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript('Listening... (e.g. say "7brd" or "invoices")');
      };

      recognition.onresult = (event: any) => {
        const current = event.resultIndex;
        const text = event.results[current][0].transcript.trim();
        setTranscript(text);

        if (event.results[current].isFinal) {
          processVoiceCommand(text);
          setTimeout(() => {
            setIsListening(false);
            setShowVoiceHUD(false);
          }, 1200);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech Recognition Event:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const processVoiceCommand = (rawText: string) => {
    const text = rawText.toLowerCase().trim();

    // 1. Direct tag/keyword recognition (e.g., "7brd" or "seven bird" or "7 bird")
    if (text.includes('7brd') || text.includes('7 bird') || text.includes('seven bird') || text.includes('thunderbird')) {
      onTranscript('7brd');
      if (onVoiceCommand) onVoiceCommand({ type: 'filter', value: '7brd' });
      return;
    }

    // 2. Folder commands
    if (text.includes('go to sent') || text === 'sent') {
      if (onVoiceCommand) onVoiceCommand({ type: 'folder', value: 'sent' });
      return;
    }
    if (text.includes('starred') || text === 'favorites') {
      if (onVoiceCommand) onVoiceCommand({ type: 'folder', value: 'starred' });
      return;
    }
    if (text.includes('inbox')) {
      if (onVoiceCommand) onVoiceCommand({ type: 'folder', value: 'inbox' });
      return;
    }
    if (text.includes('clear') || text.includes('reset')) {
      onTranscript('');
      if (onVoiceCommand) onVoiceCommand({ type: 'clear', value: '' });
      return;
    }

    // Default: pass as general search filter
    onTranscript(rawText);
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setShowVoiceHUD(false);
    } else {
      setShowVoiceHUD(true);
      try {
        if (recognitionRef.current) {
          recognitionRef.current.start();
        } else {
          // If native recognition is unavailable, show simulated voice interface
          setIsListening(true);
          setTranscript('Ready (Click quick phrase or speak)');
        }
      } catch (e) {
        setIsListening(true);
      }
    }
  };

  const presets: Array<{ label: string; spoken: string; command: string; featured?: boolean }> = [
    { label: 'Say “7brd”', spoken: '7brd', command: '7brd', featured: true },
    { label: '“Invoices”', spoken: 'invoices', command: 'invoice' },
    { label: '“Starred”', spoken: 'starred', command: 'starred' },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleListening}
        className={`relative grid size-8 place-items-center rounded-xl transition-colors ${
          isListening ? 'bg-primary text-white shadow-warm' : 'text-muted hover:bg-sunken hover:text-primary'
        }`}
        title="Voice search (say '7brd', 'invoices', or 'sent')"
        aria-pressed={isListening}
      >
        {isListening &&
          [0, 1].map((i) => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-xl border-2 border-primary"
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.7, ease: 'easeOut' }}
            />
          ))}
        <Mic className="relative size-4" />
      </button>

      <AnimatePresence>
        {showVoiceHUD && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.15 } }}
            transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
            className="pane absolute right-0 top-11 z-50 w-72 origin-top-right !rounded-2xl p-4 text-xs shadow-warm-lg"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-foreground">
                <Cpu className="size-3.5 text-primary" />
                Local voice nav
              </span>
              <span className="chip border-moss/25 bg-moss/10 font-mono text-moss">on-device</span>
            </div>

            {isListening && (
              <div className="my-3 flex h-8 items-end justify-center gap-1">
                {[0.5, 0.85, 1, 0.7, 0.9, 0.55, 0.8].map((h, i) => (
                  <span
                    key={i}
                    className="eq-bar w-1 rounded-full bg-gradient-to-t from-primary to-marigold"
                    style={{ height: `${h * 100}%`, animationDelay: `${i * 0.11}s` }}
                  />
                ))}
              </div>
            )}

            <div className="flex min-h-[40px] items-center justify-center rounded-xl bg-sunken px-3 py-2.5 text-center font-medium text-foreground shadow-pressed">
              {transcript || 'Listening for a keyword…'}
            </div>

            <div className="mt-3 border-t border-border/70 pt-3">
              <div className="eyebrow mb-2">Presets</div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <button
                    key={preset.spoken}
                    type="button"
                    onClick={() => {
                      setTranscript(preset.spoken);
                      processVoiceCommand(preset.command);
                      setTimeout(() => setShowVoiceHUD(false), 500);
                    }}
                    className={`chip !px-2.5 !py-1 transition-colors ${
                      preset.featured
                        ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                        : 'border-border bg-surface text-foreground/80 hover:border-primary/30'
                    }`}
                  >
                    {preset.featured && <Sparkles className="size-3" />}
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
