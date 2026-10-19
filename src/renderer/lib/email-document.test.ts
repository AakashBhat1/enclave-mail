// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildEmailDocument } from './email-document';

function parse(srcdoc: string): Document {
  return new DOMParser().parseFromString(srcdoc, 'text/html');
}

function csp(doc: Document): string {
  return doc.head.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
}

describe('buildEmailDocument', () => {
  it('removes anything that could run or leave the frame', () => {
    const { srcdoc } = buildEmailDocument(
      '<script>alert(1)</script><img src="data:image/png;base64,AA" onerror="alert(2)"><a href="javascript:alert(3)">x</a>' +
        '<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input></form>' +
        '<meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/a.css"><base href="https://evil.example/">',
      { allowRemote: false }
    );
    const doc = parse(srcdoc);
    for (const selector of ['script', 'iframe', 'form', 'meta[http-equiv="refresh"]', 'link', 'base[href]', '[onerror]', 'a[href^="javascript"]']) {
      expect(doc.querySelector(selector), selector).toBeNull();
    }
  });

  it('puts its own CSP and link target first in the head', () => {
    const doc = parse(buildEmailDocument('<p>Hi</p>', { allowRemote: false }).srcdoc);
    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(csp(doc)).toContain("default-src 'none'");
    expect(csp(doc)).toMatch(/img-src data: cid:;/);
    expect(doc.querySelector('base')?.getAttribute('target')).toBe('_blank');
  });

  it('blocks and counts every remote reference while remote content is off', () => {
    const { srcdoc, blockedCount } = buildEmailDocument(
      [
        '<img src="https://tracker.example/p.png?id=1">',
        '<img src="//tracker.example/p2.png">',
        '<img srcset="https://tracker.example/a.png 1x, https://tracker.example/b.png 2x">',
        '<table background="http://tracker.example/bg.png"><tr><td>x</td></tr></table>',
        '<div style="color:red;background:url(\'https://tracker.example/s.png\') no-repeat">y</div>',
        '<style>.a{background-image:url(https://tracker.example/c.png)} @import url("https://tracker.example/i.css");</style>',
      ].join(''),
      { allowRemote: false }
    );
    expect(srcdoc).not.toContain('tracker.example');
    expect(blockedCount).toBe(6);
    // The rest of the styling survives
    expect(srcdoc).toContain('color:red');
    expect(srcdoc).toContain('no-repeat');
  });

  it('blocks remote references written in forms a browser still resolves', () => {
    const tricks = [
      '<img src="\\\\tracker.example/a.png">',
      '<img src="/\\tracker.example/b.png">',
      '<img src="https:tracker.example/c.png">',
      '<img src="ht&#9;tps://tracker.example/d.png">',
      '<img src="tracker-relative.png">',
      '<svg><image href="https://tracker.example/e.png"></image></svg>',
      '<svg><image xlink:href="https://tracker.example/f.png"></image></svg>',
      '<svg><style>.x{fill:url(https://tracker.example/g.svg#p)}</style></svg>',
      '<div style="background:u\\72l(https://tracker.example/h.png)">h</div>',
      '<div style="background:url(\\68ttps://tracker.example/i.png)">i</div>',
      '<div style="background-image:image-set(\'https://tracker.example/j.png\' 1x)">j</div>',
    ];
    const { srcdoc, blockedCount } = buildEmailDocument(tricks.join(''), { allowRemote: false });
    expect(srcdoc).not.toContain('tracker.example');
    expect(srcdoc).not.toContain('tracker-relative');
    expect(blockedCount).toBe(tricks.length);
  });

  it('leaves links alone, since they open in the browser only when clicked', () => {
    const { srcdoc, blockedCount } = buildEmailDocument('<a href="https://site.example/read">Read</a><svg><a href="https://site.example/svg"><text>t</text></a></svg>', {
      allowRemote: false,
    });
    expect(srcdoc).toContain('https://site.example/read');
    expect(srcdoc).toContain('https://site.example/svg');
    expect(blockedCount).toBe(0);
  });

  it('keeps embedded and inline images', () => {
    const { srcdoc, blockedCount } = buildEmailDocument('<img src="data:image/png;base64,AAAA"><img src="cid:logo@acme">', { allowRemote: false });
    const images = [...parse(srcdoc).querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(images).toEqual(['data:image/png;base64,AAAA', 'cid:logo@acme']);
    expect(blockedCount).toBe(0);
  });

  it('lets remote images through once the user allows them', () => {
    const { srcdoc, blockedCount } = buildEmailDocument('<img src="https://cdn.example/hero.png"><div style="background:url(https://cdn.example/bg.png)">z</div>', {
      allowRemote: true,
    });
    const doc = parse(srcdoc);
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/hero.png');
    expect(srcdoc).toContain('https://cdn.example/bg.png');
    expect(blockedCount).toBe(0);
    expect(csp(doc)).toMatch(/img-src data: cid: https: http:;/);
  });

  it('never lets a remote stylesheet in, even when remote content is on', () => {
    const { srcdoc } = buildEmailDocument('<style>@import url(https://cdn.example/x.css); p{color:blue}</style><p>a</p>', { allowRemote: true });
    expect(srcdoc).not.toContain('@import');
    expect(srcdoc).toContain('p{color:blue}');
  });

  it("keeps an email's own head styles, since the frame contains them", () => {
    const { srcdoc } = buildEmailDocument('<html><head><style>.brand{color:#ff0066}</style></head><body><p class="brand">Sale</p></body></html>', {
      allowRemote: false,
    });
    const doc = parse(srcdoc);
    expect([...doc.head.querySelectorAll('style')].map((s) => s.textContent).join('')).toContain('.brand{color:#ff0066}');
    expect(doc.body.querySelector('.brand')?.textContent).toBe('Sale');
  });
});
