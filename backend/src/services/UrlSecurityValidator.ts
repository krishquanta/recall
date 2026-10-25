import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { ResearchSettings } from '../types';

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  approvedDomains: [
    'wikipedia.org',
    'en.wikipedia.org',
    'arxiv.org',
    'export.arxiv.org',
    '*.edu',
    '*.gov',
    'pubmed.ncbi.nlm.nih.gov',
    'nih.gov',
  ],
  maxQueriesPerTask: 3,
  maxSourcesPerTask: 5,
  maxExecutionTimeMs: 120000,
  enableDuckDuckGo: true,
  enableWikipediaApi: true,
  enableArxivApi: true,
};

export class UrlSecurityValidator {
  private allowedDomains: string[];

  constructor(allowedDomains?: string[]) {
    if (allowedDomains && allowedDomains.length > 0) {
      this.allowedDomains = allowedDomains;
    } else {
      this.allowedDomains = this.loadAllowedDomainsFromSettings();
    }
  }

  private getSettingsPath(): string {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    return path.join(dataDir, 'research_settings.json');
  }

  private loadAllowedDomainsFromSettings(): string[] {
    try {
      const settingsPath = this.getSettingsPath();
      if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.approvedDomains) && parsed.approvedDomains.length > 0) {
          return parsed.approvedDomains;
        }
      }
    } catch {
      // Fallback to defaults on read error
    }
    return [...DEFAULT_RESEARCH_SETTINGS.approvedDomains];
  }

  /** Reload the allowlist from supplied array. */
  public updateAllowedDomains(domains: string[]): void {
    if (Array.isArray(domains)) {
      this.allowedDomains = domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
    }
  }

  public getAllowedDomains(): string[] {
    return [...this.allowedDomains];
  }

  /**
   * Checks if a hostname matches an approved domain or wildcard (*.edu, *.gov).
   * Exact match or subdomain suffix match (e.g. en.wikipedia.org matches wikipedia.org).
   * Does NOT match evil-wikipedia.org or fake.edu.evil.com.
   */
  public isDomainAllowed(hostname: string): boolean {
    if (!hostname) return false;
    const cleanHost = hostname.trim().toLowerCase().replace(/\.$/, '');

    for (const rule of this.allowedDomains) {
      const cleanRule = rule.trim().toLowerCase().replace(/\.$/, '');
      if (!cleanRule) continue;

      if (cleanRule.startsWith('*.')) {
        // Wildcard e.g. *.edu or *.gov
        const suffix = cleanRule.slice(1); // e.g. .edu
        if (cleanHost.endsWith(suffix) || cleanHost === cleanRule.slice(2)) {
          return true;
        }
      } else {
        // Exact match or subdomain: wikipedia.org matches wikipedia.org & en.wikipedia.org
        if (cleanHost === cleanRule || cleanHost.endsWith('.' + cleanRule)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks if an IP belongs to RFC 1918, loopback, link-local, carrier-grade NAT,
   * cloud metadata, or private IPv6 ranges.
   */
  public isPrivateOrReservedIp(ip: string): boolean {
    if (!ip) return true;
    let cleanIp = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

    // Check IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (cleanIp.startsWith('::ffff:')) {
      cleanIp = cleanIp.substring(7);
    }

    // IPv4 check
    const ipv4Parts = cleanIp.split('.').map((p) => parseInt(p, 10));
    if (ipv4Parts.length === 4 && ipv4Parts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
      const [a, b] = ipv4Parts;

      // 0.0.0.0/8
      if (a === 0) return true;

      // 10.0.0.0/8 (RFC 1918)
      if (a === 10) return true;

      // 100.64.0.0/10 (Carrier Grade NAT)
      if (a === 100 && b >= 64 && b <= 127) return true;

      // 127.0.0.0/8 (Loopback)
      if (a === 127) return true;

      // 169.254.0.0/16 (Link Local & Cloud Metadata 169.254.169.254)
      if (a === 169 && b === 254) return true;

      // 172.16.0.0/12 (RFC 1918: 172.16.0.0 - 172.31.255.255)
      if (a === 172 && b >= 16 && b <= 31) return true;

      // 192.168.0.0/16 (RFC 1918)
      if (a === 192 && b === 168) return true;

      // Broadcast or multicast: 224.0.0.0/4, 255.255.255.255
      if (a >= 224) return true;

      return false;
    }

    // IPv6 check
    // Loopback ::1, Unspecified :: or 0:0:0:0:0:0:0:1
    if (
      cleanIp === '::1' ||
      cleanIp === '::' ||
      /^(?:0+:){7}0*1$/.test(cleanIp) ||
      /^(?:::)?(?:0+:)*0*1$/.test(cleanIp) ||
      cleanIp.split(':').every((part) => !part || /^0+$/.test(part))
    ) {
      return true;
    }

    // Link-local: fe80::/10 (fe80 to febf)
    if (/^fe[89ab][0-9a-f]/i.test(cleanIp)) return true;

    // Unique Local Address (ULA) RFC 4193: fc00::/7 (fc or fd)
    if (/^f[cd][0-9a-f]{2}:/i.test(cleanIp)) return true;

    // IPv6 multicast: ff00::/8
    if (/^ff[0-9a-f]{2}:/i.test(cleanIp)) return true;

    // localhost string
    if (cleanIp === 'localhost') return true;

    return false;
  }

  /**
   * Full pre-flight validation: scheme check, hostname allowlist, DNS resolution, SSRF IP blocking.
   */
  public async validateUrl(rawUrl: string): Promise<{ valid: boolean; reason?: string; resolvedIp?: string }> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return { valid: false, reason: 'Invalid URL format' };
    }

    // 1. Protocol check: http / https only
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { valid: false, reason: `Unsupported protocol: ${parsedUrl.protocol}` };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 2. Reject obvious private hostnames
    if (hostname === 'localhost' || this.isPrivateOrReservedIp(hostname)) {
      return { valid: false, reason: 'Direct access to private or loopback host blocked' };
    }

    // 3. Domain allowlist check
    if (!this.isDomainAllowed(hostname)) {
      return { valid: false, reason: `Domain ${hostname} is not in the approved allowlist` };
    }

    // 4. DNS pre-flight resolution to check for DNS rebinding / private IP behind public hostname
    try {
      const addresses = await dns.promises.lookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        return { valid: false, reason: `DNS resolution failed for host ${hostname}` };
      }

      for (const addr of addresses) {
        if (this.isPrivateOrReservedIp(addr.address)) {
          return {
            valid: false,
            reason: `Host ${hostname} resolved to private/reserved IP: ${addr.address}`,
            resolvedIp: addr.address,
          };
        }
      }

      return { valid: true, resolvedIp: addresses[0].address };
    } catch (err: any) {
      return { valid: false, reason: `DNS lookup error: ${err?.message || 'unknown error'}` };
    }
  }

  /**
   * Strips scripts, styles, iframes, noscript, hidden tags; extracts plain readable text.
   */
  public sanitizeHtml(html: string): string {
    if (!html) return '';

    // Strip scripts, styles, iframes, noscript, object, embed
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, ' ')
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, ' ');

    // Strip remaining HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    cleaned = cleaned
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–');

    // Collapse whitespace
    return cleaned.replace(/\s+/g, ' ').trim();
  }
}

export const urlSecurityValidator = new UrlSecurityValidator();
