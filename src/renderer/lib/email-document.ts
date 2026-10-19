import DOMPurify from 'dompurify';

export interface EmailDocumentOptions {
  /** Remote images and fonts load only when the user asked for them (they double as read-tracking beacons). */
  allowRemote: boolean;
}

export interface EmailDocument {
  /** A complete page for a sandboxed iframe's srcdoc. */
  srcdoc: string;
  /** How many remote references were removed; drives the "load images" banner. */
  blockedCount: number;
}

// Also covered by the frame sandbox and CSP; stripped anyway so nothing relies on a single layer
const FORBID_TAGS = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'base', 'meta', 'link'];
const URL_ATTRS = ['src', 'srcset', 'background', 'poster', 'href', 'xlink:href'];
// On these an href is a link the user clicks, not something fetched when the letter opens
const LINK_TAGS = new Set(['a', 'area']);
// An allow-list: browsers resolve "\\host", "/\host", "https:host" and tab-split schemes, so a block-list leaks
const EMBEDDED_URL = /^(?:data:|cid:|#)/i;
// The URL parser drops tabs and newlines anywhere and trims leading control characters and spaces
const IGNORED_URL_CHARS = /[\t\n\r]/g;
const LEADING_URL_JUNK = /^[\x00-\x20]+/;
const REMOTE_START = String.raw`(?:https?:|[\\/]{2})`;
const CSS_REMOTE_URL = new RegExp(String.raw`url\(\s*(['"]?)\s*${REMOTE_START}[^)]*?\1\s*\)`, 'gi');
// image-set() also takes bare strings as image URLs
const CSS_IMAGE_SET = /image-set\(([^;}]*)\)/gi;
const CSS_REMOTE_STRING = new RegExp(String.raw`(['"])\s*${REMOTE_START}[^'"]*\1`, 'gi');
const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})\s?|([^\n0-9a-f]))/gi;
const CSS_IMPORT = /@import\s+[^;]+;?/gi;

// Base look for letters; the email's own styles come after and win
const BASE_STYLE = [
  'html,body{margin:0;padding:0;background:transparent}',
  // The frame grows to fit the letter, so a letter sized from the frame (100vh, 100%) would chase it
  'html,body{height:auto!important;min-height:0!important}',
  'body{font:14px/1.65 "Segoe UI",system-ui,-apple-system,sans-serif;color:#2B1E16;overflow-wrap:break-word}',
  'img{max-width:100%;height:auto}',
  'a{color:#B4531F}',
  'blockquote{margin:0 0 0 .6em;padding-left:.8em;border-left:2px solid #E9DCC9;color:#6B5A4C}',
].join('');

// Remote fonts stay off either way: the app page's own policy (which frames inherit) never allows them
export function emailCsp(allowRemote: boolean): string {
  return [
    "default-src 'none'",
    `img-src data: cid:${allowRemote ? ' https: http:' : ''}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    "form-action 'none'",
  ].join('; ');
}

// One purifier just for email, so its hooks never touch other sanitising in the app. The cast only bridges
// two identical copies of @types/trusted-types that pnpm links from different paths.
const purifier = DOMPurify(window as unknown as Parameters<typeof DOMPurify>[0]);
let pass = { allowRemote: false, blocked: 0 };

function isEmbeddedUrl(value: string): boolean {
  const url = value.replace(IGNORED_URL_CHARS, '').replace(LEADING_URL_JUNK, '');
  return url === '' || EMBEDDED_URL.test(url);
}

function decodeCssEscapes(css: string): string {
  return css.replace(CSS_ESCAPE, (_m, hex: string | undefined, char: string | undefined) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : (char ?? '')
  );
}

function stripRemoteCss(css: string): string {
  // Escapes can spell out url( or https: so the patterns miss them; only then is the decoded text used
  const decoded = decodeCssEscapes(css);
  const hidden = decoded !== css && (decoded.search(CSS_REMOTE_URL) >= 0 || decoded.search(CSS_IMAGE_SET) >= 0);
  const source = hidden ? decoded : css;
  const block = () => {
    pass.blocked += 1;
    return 'none';
  };
  return source
    .replace(CSS_REMOTE_URL, block)
    .replace(CSS_IMAGE_SET, (whole: string, inner: string) => {
      const cleaned = inner.replace(CSS_REMOTE_STRING, block);
      return cleaned === inner ? whole : 'none';
    });
}

function isStyleElement(node: Node): boolean {
  // HTML style elements report "STYLE", SVG ones "style"
  return node.nodeName.toLowerCase() === 'style';
}

purifier.addHook('uponSanitizeElement', (node) => {
  if (!isStyleElement(node) || !node.textContent) return;
  const withoutImports = node.textContent.replace(CSS_IMPORT, '');
  node.textContent = pass.allowRemote ? withoutImports : stripRemoteCss(withoutImports);
});

function isFetchedUrlAttr(node: Element, attr: string): boolean {
  return !(attr.endsWith('href') && LINK_TAGS.has(node.nodeName.toLowerCase()));
}

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (pass.allowRemote || !(node instanceof Element)) return;
  for (const attr of URL_ATTRS) {
    const value = node.getAttribute(attr);
    if (value === null || !isFetchedUrlAttr(node, attr)) continue;
    // A srcset lists several candidates; one remote entry is enough to track
    const embedded = attr === 'srcset' ? value.split(',').every((part) => isEmbeddedUrl(part.trim().split(/\s+/)[0] ?? '')) : isEmbeddedUrl(value);
    if (embedded) continue;
    node.removeAttribute(attr);
    pass.blocked += 1;
  }
  const style = node.getAttribute('style');
  if (!style) return;
  const stripped = stripRemoteCss(style);
  if (stripped !== style) node.setAttribute('style', stripped);
});

/** Sanitises an HTML email into a self-contained page for a sandboxed iframe. */
export function buildEmailDocument(html: string, { allowRemote }: EmailDocumentOptions): EmailDocument {
  pass = { allowRemote, blocked: 0 };
  const clean = purifier.sanitize(html, { WHOLE_DOCUMENT: true, FORBID_TAGS });
  const blockedCount = pass.blocked;

  const doc = new DOMParser().parseFromString(clean, 'text/html');
  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', emailCsp(allowRemote));
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  // Links open through the main process (system browser), never inside the frame
  const base = doc.createElement('base');
  base.setAttribute('target', '_blank');
  const style = doc.createElement('style');
  style.textContent = BASE_STYLE;
  doc.head.prepend(csp, charset, base, style);

  return { srcdoc: `<!doctype html>${doc.documentElement.outerHTML}`, blockedCount };
}
