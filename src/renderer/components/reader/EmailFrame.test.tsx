// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailFrame } from './EmailFrame';

const MARKER = 'email-body-marker';
const SRCDOC = `<!doctype html><html><head></head><body><p id="${MARKER}">Hello</p><style>#root{display:none}</style></body></html>`;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver; the frame only needs it once the letter has loaded
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<EmailFrame srcdoc={SRCDOC} title="Email: Hello" />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const frame = () => container.querySelector('iframe') as HTMLIFrameElement;

describe('EmailFrame', () => {
  it('hands the letter to the frame and never to the app document', () => {
    expect(frame().getAttribute('srcdoc')).toBe(SRCDOC);
    expect(document.getElementById(MARKER)).toBeNull();
    expect(document.querySelector('style')).toBeNull();
    expect(container.children).toHaveLength(1);
  });

  it('is sandboxed without scripts, top navigation or forms', () => {
    const tokens = frame().getAttribute('sandbox')?.split(/\s+/) ?? [];
    expect(tokens).toEqual(expect.arrayContaining(['allow-same-origin', 'allow-popups']));
    for (const forbidden of ['allow-scripts', 'allow-top-navigation', 'allow-forms', 'allow-modals']) {
      expect(tokens).not.toContain(forbidden);
    }
  });

  it('sends no referrer and carries an accessible title', () => {
    expect(frame().getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame().title).toBe('Email: Hello');
  });
});
