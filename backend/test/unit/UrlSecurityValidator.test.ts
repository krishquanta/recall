import { describe, it, expect, beforeEach } from 'vitest';
import { UrlSecurityValidator } from '../../src/services/UrlSecurityValidator';

describe('UrlSecurityValidator Unit Tests', () => {
  let validator: UrlSecurityValidator;

  beforeEach(() => {
    validator = new UrlSecurityValidator(['wikipedia.org', 'arxiv.org', '*.edu', '*.gov']);
  });

  describe('isDomainAllowed', () => {
    it('matches exact allowed domain', () => {
      expect(validator.isDomainAllowed('wikipedia.org')).toBe(true);
      expect(validator.isDomainAllowed('arxiv.org')).toBe(true);
    });

    it('matches subdomains of allowed domain', () => {
      expect(validator.isDomainAllowed('en.wikipedia.org')).toBe(true);
      expect(validator.isDomainAllowed('de.wikipedia.org')).toBe(true);
      expect(validator.isDomainAllowed('export.arxiv.org')).toBe(true);
    });

    it('rejects lookalike or prefix spoofed domains', () => {
      expect(validator.isDomainAllowed('evil-wikipedia.org')).toBe(false);
      expect(validator.isDomainAllowed('wikipedia.org.evil.com')).toBe(false);
      expect(validator.isDomainAllowed('notarxiv.org')).toBe(false);
    });

    it('matches wildcard domains (*.edu, *.gov)', () => {
      expect(validator.isDomainAllowed('mit.edu')).toBe(true);
      expect(validator.isDomainAllowed('cs.stanford.edu')).toBe(true);
      expect(validator.isDomainAllowed('nih.gov')).toBe(true);
      expect(validator.isDomainAllowed('nasa.gov')).toBe(true);
    });

    it('rejects subdomain spoofing of wildcards', () => {
      expect(validator.isDomainAllowed('fake.edu.evil.com')).toBe(false);
      expect(validator.isDomainAllowed('edu.attacker.net')).toBe(false);
      expect(validator.isDomainAllowed('gov.co')).toBe(false);
    });

    it('handles uppercase and trailing dots gracefully', () => {
      expect(validator.isDomainAllowed('EN.WIKIPEDIA.ORG.')).toBe(true);
      expect(validator.isDomainAllowed('MIT.EDU.')).toBe(true);
    });
  });

  describe('isPrivateOrReservedIp', () => {
    it('detects RFC 1918 private IPv4 ranges', () => {
      expect(validator.isPrivateOrReservedIp('10.0.0.1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('10.255.255.255')).toBe(true);
      expect(validator.isPrivateOrReservedIp('172.16.0.1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('172.31.255.255')).toBe(true);
      expect(validator.isPrivateOrReservedIp('192.168.0.1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('192.168.1.100')).toBe(true);
    });

    it('allows public IPv4 ranges outside private blocks', () => {
      expect(validator.isPrivateOrReservedIp('8.8.8.8')).toBe(false);
      expect(validator.isPrivateOrReservedIp('1.1.1.1')).toBe(false);
      expect(validator.isPrivateOrReservedIp('172.32.0.1')).toBe(false);
      expect(validator.isPrivateOrReservedIp('192.169.1.1')).toBe(false);
    });

    it('detects loopback and localhost addresses', () => {
      expect(validator.isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('127.0.1.1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('localhost')).toBe(true);
      expect(validator.isPrivateOrReservedIp('::1')).toBe(true);
    });

    it('detects cloud metadata and link-local IP (169.254.169.254)', () => {
      expect(validator.isPrivateOrReservedIp('169.254.169.254')).toBe(true);
      expect(validator.isPrivateOrReservedIp('169.254.0.1')).toBe(true);
    });

    it('detects carrier-grade NAT (100.64.0.0/10)', () => {
      expect(validator.isPrivateOrReservedIp('100.64.0.1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('100.127.255.255')).toBe(true);
      expect(validator.isPrivateOrReservedIp('100.63.255.255')).toBe(false);
      expect(validator.isPrivateOrReservedIp('100.128.0.1')).toBe(false);
    });

    it('detects IPv6 private, link-local, and ULA ranges', () => {
      expect(validator.isPrivateOrReservedIp('fe80::1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('fc00::1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('fd12:3456:789a::1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
      expect(validator.isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);
      // Bracketed IPv6 format from URLs
      expect(validator.isPrivateOrReservedIp('[::1]')).toBe(true);
      expect(validator.isPrivateOrReservedIp('[fc00::1]')).toBe(true);
      expect(validator.isPrivateOrReservedIp('[::ffff:127.0.0.1]')).toBe(true);
      // Expanded zero IPv6 loopback
      expect(validator.isPrivateOrReservedIp('0:0:0:0:0:0:0:1')).toBe(true);
    });
  });

  describe('validateUrl', () => {
    it('rejects invalid URL strings', async () => {
      const res = await validator.validateUrl('not a url');
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Invalid URL format');
    });

    it('rejects unsupported protocols (ftp, file, javascript)', async () => {
      expect((await validator.validateUrl('ftp://wikipedia.org/file.txt')).valid).toBe(false);
      expect((await validator.validateUrl('file:///etc/passwd')).valid).toBe(false);
      expect((await validator.validateUrl('javascript:alert(1)')).valid).toBe(false);
    });

    it('rejects direct access to private IPs or localhost', async () => {
      expect((await validator.validateUrl('http://localhost:3000')).valid).toBe(false);
      expect((await validator.validateUrl('http://127.0.0.1/admin')).valid).toBe(false);
      expect((await validator.validateUrl('http://169.254.169.254/latest/meta-data')).valid).toBe(false);
    });

    it('rejects non-allowlisted domains', async () => {
      const res = await validator.validateUrl('https://evil-hacker.com/payload');
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('not in the approved allowlist');
    });

    it('accepts valid allowlisted domain URL with public IP resolution', async () => {
      const res = await validator.validateUrl('https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm');
      expect(res.valid).toBe(true);
      expect(res.resolvedIp).toBeDefined();
    });
  });

  describe('sanitizeHtml', () => {
    it('strips script, style, iframe, and noscript tags completely', () => {
      const dirtyHtml = `
        <html>
          <head>
            <style>body { color: red; }</style>
            <script>alert("pwned");</script>
          </head>
          <body>
            <h1>Algorithm Title</h1>
            <iframe src="http://evil.com"></iframe>
            <noscript>Enable JS</noscript>
            <p>Dijkstra's algorithm finds shortest paths in a graph.</p>
          </body>
        </html>
      `;

      const sanitized = validator.sanitizeHtml(dirtyHtml);
      expect(sanitized).not.toContain('alert');
      expect(sanitized).not.toContain('color: red');
      expect(sanitized).not.toContain('evil.com');
      expect(sanitized).not.toContain('Enable JS');
      expect(sanitized).toContain("Algorithm Title Dijkstra's algorithm finds shortest paths in a graph.");
    });

    it('decodes HTML entities and collapses whitespace', () => {
      const entityHtml = '<p>Dijkstra &amp; Prim &mdash; &quot;Greedy&quot; &lt;methods&gt; &nbsp; &nbsp;</p>';
      const sanitized = validator.sanitizeHtml(entityHtml);
      expect(sanitized).toBe('Dijkstra & Prim — "Greedy" <methods>');
    });

    it('handles empty or whitespace string without throwing', () => {
      expect(validator.sanitizeHtml('')).toBe('');
      expect(validator.sanitizeHtml('   \n\t  ')).toBe('');
    });
  });
});
