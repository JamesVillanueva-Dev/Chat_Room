import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const unfurl = require('../../src/services/unfurl');

describe('finding a URL in a message', () => {
  it('picks the first http(s) link', () => {
    expect(unfurl.firstUrl('see https://example.com/a for details')).toBe('https://example.com/a');
    expect(unfurl.firstUrl('http://example.com')).toBe('http://example.com/');
  });

  it('drops trailing sentence punctuation', () => {
    expect(unfurl.firstUrl('look at https://example.com/page.')).toBe('https://example.com/page');
    expect(unfurl.firstUrl('really? https://example.com/x!')).toBe('https://example.com/x');
  });

  it('ignores text with no link and non-web schemes', () => {
    expect(unfurl.firstUrl('no links here')).toBeNull();
    expect(unfurl.firstUrl('javascript:alert(1)')).toBeNull();
    expect(unfurl.firstUrl('file:///etc/passwd')).toBeNull();
    expect(unfurl.firstUrl('')).toBeNull();
  });
});

describe('SSRF protection', () => {
  it('treats loopback, private and link-local addresses as blocked', () => {
    const blocked = [
      '127.0.0.1', '127.1.2.3', '0.0.0.0',
      '10.0.0.1', '10.255.255.255',
      '172.16.0.1', '172.31.255.1',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata endpoint
      '100.64.0.1', // carrier-grade NAT
      '224.0.0.1', '255.255.255.255',
      '::1', 'fe80::1', 'fc00::1', 'fd12::3',
      '::ffff:127.0.0.1',
    ];
    for (const address of blocked) {
      expect(unfurl.isPrivateAddress(address), `${address} should be blocked`).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) {
      expect(unfurl.isPrivateAddress(address), `${address} should be allowed`).toBe(false);
    }
  });

  it('treats anything unparseable as unsafe', () => {
    expect(unfurl.isPrivateAddress('not-an-ip')).toBe(true);
    expect(unfurl.isPrivateAddress('')).toBe(true);
  });
});

describe('Open Graph parsing', () => {
  const page = `
    <html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Real Title &amp; More" />
      <meta property="og:description" content="A &quot;quoted&quot; description" />
      <meta property="og:site_name" content="Example" />
      <meta property="og:image" content="/images/hero.png" />
    </head><body>hi</body></html>`;

  it('reads Open Graph tags and decodes entities', () => {
    const meta = unfurl.parseMetadata(page, 'https://example.com/post');
    expect(meta.title).toBe('Real Title & More');
    expect(meta.description).toBe('A "quoted" description');
    expect(meta.siteName).toBe('Example');
  });

  it('resolves a relative image against the page URL', () => {
    const meta = unfurl.parseMetadata(page, 'https://example.com/post');
    expect(meta.imageUrl).toBe('https://example.com/images/hero.png');
  });

  it('falls back to the <title> tag', () => {
    const meta = unfurl.parseMetadata('<html><head><title>Just A Title</title></head></html>', 'https://example.com');
    expect(meta.title).toBe('Just A Title');
    expect(meta.description).toBeNull();
  });

  it('refuses a non-http image URL', () => {
    const hostile = '<meta property="og:image" content="javascript:alert(1)">';
    expect(unfurl.parseMetadata(hostile, 'https://example.com').imageUrl).toBeNull();
  });

  it('clamps very long values', () => {
    const long = `<meta property="og:title" content="${'x'.repeat(400)}">`;
    expect(unfurl.parseMetadata(long, 'https://example.com').title.length).toBeLessThanOrEqual(180);
  });

  it('returns nothing useful for a page without metadata', () => {
    const meta = unfurl.parseMetadata('<html><body>nothing</body></html>', 'https://example.com');
    expect(meta.title).toBeNull();
    expect(meta.description).toBeNull();
    expect(meta.imageUrl).toBeNull();
  });
});

describe('entity decoding', () => {
  it('handles named and numeric entities', () => {
    expect(unfurl.decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42; &quot;q&quot;')).toBe('a & b <c> A B "q"');
  });
});
