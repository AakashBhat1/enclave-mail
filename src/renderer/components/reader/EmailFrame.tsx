import { useCallback, useEffect, useRef, useState } from 'react';
import { INITIAL_SIZING, nextSizing, restartSizing } from './frame-sizing';

interface EmailFrameProps {
  srcdoc: string;
  title: string;
}

// No allow-scripts: nothing in an email ever runs. allow-same-origin only lets the app read the
// content height; allow-popups lets <base target=_blank> links reach the main process, which opens
// them in the system browser and never as an app window.
const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

/** Renders an email page (see buildEmailDocument) in an isolated frame that grows to fit it. */
export function EmailFrame({ srcdoc, title }: EmailFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [sizing, setSizing] = useState(INITIAL_SIZING);

  const measure = useCallback(() => {
    const root = frameRef.current?.contentDocument?.documentElement;
    if (root) setSizing((current) => nextSizing(current, root.scrollHeight));
  }, []);

  // Images and late styles change the height after load, so keep watching the body
  const handleLoad = useCallback(() => {
    observerRef.current?.disconnect();
    setSizing(restartSizing);
    measure();
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(body);
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);
  // A letter that sizes itself from the frame would grow forever, so stop watching it
  useEffect(() => {
    if (sizing.locked) observerRef.current?.disconnect();
  }, [sizing.locked]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      srcDoc={srcdoc}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      onLoad={handleLoad}
      className="block w-full border-0"
      style={{ height: sizing.height }}
    />
  );
}
