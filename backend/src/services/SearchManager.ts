import { v4 as uuidv4 } from 'uuid';
import { ResearchBudget, ResearchSource } from '../types';
import { UrlSecurityValidator, urlSecurityValidator } from './UrlSecurityValidator';

export class SearchManager {
  private securityValidator: UrlSecurityValidator;

  constructor(securityValidator?: UrlSecurityValidator) {
    this.securityValidator = securityValidator || urlSecurityValidator;
  }

  private isTimeExpired(budget: ResearchBudget): boolean {
    return Date.now() - budget.startTimeMs >= budget.maxExecutionTimeMs;
  }

  private getFetchSignal(budget: ResearchBudget, timeoutCapMs = 10000): AbortSignal {
    const elapsed = Date.now() - budget.startTimeMs;
    const remainingTime = Math.max(1000, budget.maxExecutionTimeMs - elapsed);
    const timeoutMs = Math.min(timeoutCapMs, remainingTime);
    return AbortSignal.timeout(timeoutMs);
  }

  /**
   * Discovers candidate URLs via DuckDuckGo HTML/Lite search.
   * Respects budget counters and validates each discovered URL before returning.
   */
  public async searchDuckDuckGo(
    query: string,
    budget: ResearchBudget,
    maxResults = 5
  ): Promise<Array<{ title: string; url: string; snippet: string }>> {
    if (this.isTimeExpired(budget) || budget.queriesUsed >= budget.maxQueries) {
      return [];
    }

    budget.queriesUsed++;

    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(searchUrl, {
        signal: this.getFetchSignal(budget, 10000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
      });

      if (!res.ok) {
        return [];
      }

      const html = await res.text();
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      // Parse DuckDuckGo result blocks
      // <div class="result results_links results_links_deep web-result ">
      // <a class="result__url" href="..."> ... </a>
      // or <a class="result__snippet" ...>
      const resultBlocks = html.split(/<div[^>]*class=["'][^"']*result[^"']*["'][^>]*>/gi);

      for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
        const block = resultBlocks[i];

        // Extract URL: typically in <a class="result__url" href="..."> or <a class="result__title" href="...">
        const linkMatch =
          block.match(/<a[^>]*class=["'][^"']*(?:result__url|result__snippet|result__title)[^"']*["'][^>]*href=["']([^"']+)["']/i) ||
          block.match(/href=["'](\/\/duckduckgo\.com\/l\/\?[^"']+)["']/i) ||
          block.match(/href=["']([^"']+)["']/i);

        if (!linkMatch) continue;
        let candidateUrl = linkMatch[1];

        // If it's a DuckDuckGo redirect link (/l/?uddg=...), extract real target
        if (candidateUrl.includes('/l/?uddg=') || candidateUrl.includes('uddg=')) {
          const uddgMatch = candidateUrl.match(/uddg=([^&]+)/);
          if (uddgMatch) {
            candidateUrl = decodeURIComponent(uddgMatch[1]);
          }
        }

        if (candidateUrl.startsWith('//')) {
          candidateUrl = 'https:' + candidateUrl;
        }

        // Title
        const titleMatch = block.match(/<a[^>]*class=["'][^"']*(?:result__title|result__a)[^"']*[^>]*>([\s\S]*?)<\/a>/i);
        const rawTitle = titleMatch ? titleMatch[1] : '';
        const title = this.securityValidator.sanitizeHtml(rawTitle) || 'Search Result';

        // Snippet
        const snippetMatch = block.match(/<a[^>]*class=["'][^"']*result__snippet[^"']*[^>]*>([\s\S]*?)<\/a>/i);
        const rawSnippet = snippetMatch ? snippetMatch[1] : '';
        const snippet = this.securityValidator.sanitizeHtml(rawSnippet);

        // Security validate the candidate URL
        const validation = await this.securityValidator.validateUrl(candidateUrl);
        if (validation.valid) {
          results.push({
            title,
            url: candidateUrl,
            snippet,
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Fetches clean structured summary from Wikipedia REST API.
   * Calls https://en.wikipedia.org/api/rest_v1/page/summary/{title}.
   */
  public async fetchWikipediaSummary(
    pageTitleOrQuery: string,
    budget: ResearchBudget
  ): Promise<ResearchSource | null> {
    if (this.isTimeExpired(budget) || budget.sourcesFetched >= budget.maxSources) {
      return null;
    }

    try {
      const cleanTitle = encodeURIComponent(pageTitleOrQuery.trim().replace(/\s+/g, '_'));
      const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${cleanTitle}`;

      const validation = await this.securityValidator.validateUrl(apiUrl);
      if (!validation.valid) {
        return null;
      }

      const res = await fetch(apiUrl, {
        signal: this.getFetchSignal(budget, 10000),
        headers: {
          'User-Agent': 'RecallResearchAgent/1.0 (educational/study bank agent; contact@ai-study-bank.local)',
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as any;
      if (!data || !data.extract) {
        return null;
      }

      budget.sourcesFetched++;

      const title = data.title || pageTitleOrQuery;
      const rawText = data.extract;
      const fullText = rawText.length > 50000 ? rawText.substring(0, 50000) : rawText;
      const snippet = fullText.length > 300 ? fullText.substring(0, 300) + '...' : fullText;
      const canonicalUrl =
        data.content_urls?.desktop?.page ||
        data.canonical_url ||
        `https://en.wikipedia.org/wiki/${cleanTitle}`;

      return {
        id: `src_wiki_${uuidv4().substring(0, 8)}`,
        title,
        url: canonicalUrl,
        domain: 'en.wikipedia.org',
        retrievedAt: new Date().toISOString(),
        snippet,
        fullText,
        authorOrPublisher: 'Wikipedia Contributors',
      };
    } catch {
      return null;
    }
  }

  /**
   * Queries arXiv API for papers, abstracts, and publication dates.
   * Calls http://export.arxiv.org/api/query.
   */
  public async searchArxiv(
    query: string,
    budget: ResearchBudget,
    maxResults = 3
  ): Promise<ResearchSource[]> {
    if (
      this.isTimeExpired(budget) ||
      budget.queriesUsed >= budget.maxQueries ||
      budget.sourcesFetched >= budget.maxSources
    ) {
      return [];
    }

    budget.queriesUsed++;

    try {
      const apiUrl = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
        query
      )}&start=0&max_results=${maxResults}`;

      const validation = await this.securityValidator.validateUrl(apiUrl);
      if (!validation.valid) {
        return [];
      }

      const res = await fetch(apiUrl, {
        signal: this.getFetchSignal(budget, 10000),
        headers: {
          'User-Agent': 'RecallResearchAgent/1.0',
          Accept: 'application/atom+xml, application/xml',
        },
      });

      if (!res.ok) {
        return [];
      }

      const xmlText = await res.text();
      const sources: ResearchSource[] = [];

      const entryMatches = xmlText.match(/<entry>[\s\S]*?<\/entry>/gi) || [];

      for (const entryXml of entryMatches) {
        if (
          this.isTimeExpired(budget) ||
          budget.sourcesFetched >= budget.maxSources ||
          sources.length >= maxResults
        ) {
          break;
        }

        const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/i);
        const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/i);
        const idMatch = entryXml.match(/<id>([\s\S]*?)<\/id>/i);
        const authorMatches = Array.from(entryXml.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/gi)).map(
          (m) => m[1].trim()
        );

        const title = this.securityValidator.sanitizeHtml(titleMatch ? titleMatch[1] : 'arXiv Paper');
        const summary = this.securityValidator.sanitizeHtml(summaryMatch ? summaryMatch[1] : '');
        const entryUrl = idMatch ? idMatch[1].trim() : apiUrl;
        const authors = authorMatches.join(', ') || 'arXiv Author(s)';

        budget.sourcesFetched++;

        sources.push({
          id: `src_arxiv_${uuidv4().substring(0, 8)}`,
          title,
          url: entryUrl,
          domain: 'arxiv.org',
          retrievedAt: new Date().toISOString(),
          snippet: summary.length > 300 ? summary.substring(0, 300) + '...' : summary,
          fullText: summary,
          authorOrPublisher: authors,
        });
      }

      return sources;
    } catch {
      return [];
    }
  }

  /**
   * Safe fetcher: validates URL, checks SSRF, handles redirects (max 3),
   * decrements budget counters, sanitizes HTML, returns cleaned source.
   */
  public async safeFetchWebPage(
    targetUrl: string,
    budget: ResearchBudget
  ): Promise<ResearchSource | null> {
    if (this.isTimeExpired(budget) || budget.sourcesFetched >= budget.maxSources) {
      return null;
    }

    let currentUrl = targetUrl;
    let redirectCount = 0;
    const maxRedirects = budget.maxRedirectsPerUrl || 3;

    try {
      while (redirectCount <= maxRedirects) {
        if (this.isTimeExpired(budget)) return null;

        const validation = await this.securityValidator.validateUrl(currentUrl);
        if (!validation.valid) {
          return null;
        }

        const res = await fetch(currentUrl, {
          redirect: 'manual',
          signal: this.getFetchSignal(budget, 10000),
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html, text/plain',
          },
        });

        // Handle HTTP redirects (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location');
          if (!location) {
            return null;
          }

          // Resolve relative redirect against current URL
          currentUrl = new URL(location, currentUrl).toString();
          redirectCount++;
          continue;
        }

        if (!res.ok) {
          return null;
        }

        const contentType = res.headers.get('content-type') || '';
        if (
          !contentType.includes('text/html') &&
          !contentType.includes('text/plain') &&
          !contentType.includes('application/xhtml+xml')
        ) {
          return null;
        }

        const html = await res.text();
        const rawText = this.securityValidator.sanitizeHtml(html);
        if (!rawText || rawText.length < 50) {
          return null;
        }
        const fullText = rawText.length > 50000 ? rawText.substring(0, 50000) : rawText;

        budget.sourcesFetched++;

        // Extract title from HTML
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = this.securityValidator.sanitizeHtml(titleMatch ? titleMatch[1] : '') || currentUrl;

        const parsed = new URL(currentUrl);

        return {
          id: `src_web_${uuidv4().substring(0, 8)}`,
          title,
          url: currentUrl,
          domain: parsed.hostname,
          retrievedAt: new Date().toISOString(),
          snippet: fullText.length > 300 ? fullText.substring(0, 300) + '...' : fullText,
          fullText,
          authorOrPublisher: parsed.hostname,
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}

export const searchManager = new SearchManager();
