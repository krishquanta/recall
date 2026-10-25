import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SearchManager } from '../../src/services/SearchManager';
import { UrlSecurityValidator } from '../../src/services/UrlSecurityValidator';
import { ResearchBudget } from '../../src/types';

describe('SearchManager Unit Tests', () => {
  let searchManager: SearchManager;
  let mockValidator: UrlSecurityValidator;

  beforeEach(() => {
    mockValidator = new UrlSecurityValidator(['wikipedia.org', 'arxiv.org', '*.edu']);
    searchManager = new SearchManager(mockValidator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createBudget = (overrides?: Partial<ResearchBudget>): ResearchBudget => ({
    maxQueries: 3,
    maxSources: 5,
    maxExecutionTimeMs: 120000,
    maxRedirectsPerUrl: 3,
    queriesUsed: 0,
    sourcesFetched: 0,
    startTimeMs: Date.now(),
    ...overrides,
  });

  describe('fetchWikipediaSummary', () => {
    it('fetches summary, increments sourcesFetched, and returns ResearchSource', async () => {
      const budget = createBudget();
      const mockPayload = {
        title: "Dijkstra's algorithm",
        extract: "Dijkstra's algorithm is an algorithm for finding the shortest paths between nodes in a weighted graph.",
        content_urls: {
          desktop: { page: "https://en.wikipedia.org/wiki/Dijkstra's_algorithm" },
        },
      };

      vi.spyOn(mockValidator, 'validateUrl').mockResolvedValue({ valid: true, resolvedIp: '91.198.174.192' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
      } as any);

      const source = await searchManager.fetchWikipediaSummary('Dijkstra', budget);

      expect(source).not.toBeNull();
      expect(source?.title).toBe("Dijkstra's algorithm");
      expect(source?.fullText).toContain('shortest paths between nodes');
      expect(source?.domain).toBe('en.wikipedia.org');
      expect(budget.sourcesFetched).toBe(1);
    });

    it('returns null and does not increment sourcesFetched if budget exhausted', async () => {
      const budget = createBudget({ sourcesFetched: 5, maxSources: 5 });
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const source = await searchManager.fetchWikipediaSummary('Dijkstra', budget);
      expect(source).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns null if domain is blocked or URL validation fails', async () => {
      const budget = createBudget();
      vi.spyOn(mockValidator, 'validateUrl').mockResolvedValueOnce({ valid: false, reason: 'Blocked' });

      const source = await searchManager.fetchWikipediaSummary('Dijkstra', budget);
      expect(source).toBeNull();
      expect(budget.sourcesFetched).toBe(0);
    });
  });

  describe('searchArxiv', () => {
    it('parses arXiv XML entries, decrements budget, and returns sources', async () => {
      const budget = createBudget();
      const mockXml = `
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2101.00001v1</id>
            <title>Fast Graph Algorithms via Hopcroft-Karp</title>
            <summary>We present an updated bound for maximum bipartite matching in graphs.</summary>
            <author><name>John Doe</name></author>
            <author><name>Jane Smith</name></author>
          </entry>
        </feed>
      `;

      vi.spyOn(mockValidator, 'validateUrl').mockResolvedValue({ valid: true, resolvedIp: '128.84.21.18' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      } as any);

      const sources = await searchManager.searchArxiv('graph matching', budget, 2);

      expect(budget.queriesUsed).toBe(1);
      expect(budget.sourcesFetched).toBe(1);
      expect(sources.length).toBe(1);
      expect(sources[0].title).toBe('Fast Graph Algorithms via Hopcroft-Karp');
      expect(sources[0].authorOrPublisher).toContain('John Doe, Jane Smith');
      expect(sources[0].domain).toBe('arxiv.org');
    });

    it('aborts and returns empty array if queriesUsed reached maxQueries', async () => {
      const budget = createBudget({ queriesUsed: 3, maxQueries: 3 });
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const sources = await searchManager.searchArxiv('quantum computing', budget);
      expect(sources).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('searchDuckDuckGo', () => {
    it('parses HTML results, checks allowlist, and filters out non-approved domains', async () => {
      const budget = createBudget();
      const mockHtml = `
        <div class="result results_links results_links_deep web-result ">
          <a class="result__title" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FAVL_tree">AVL Tree Wikipedia</a>
          <a class="result__snippet">An AVL tree is a self-balancing binary search tree.</a>
        </div>
        <div class="result results_links results_links_deep web-result ">
          <a class="result__title" href="https://unapproved-blog.com/avl">AVL Tree Guide</a>
          <a class="result__snippet">Blog post about trees.</a>
        </div>
      `;

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => mockHtml,
      } as any);

      vi.spyOn(mockValidator, 'validateUrl').mockImplementation(async (rawUrl: string) => {
        if (rawUrl.includes('wikipedia.org')) return { valid: true };
        return { valid: false, reason: 'Domain not approved' };
      });

      const results = await searchManager.searchDuckDuckGo('AVL tree', budget, 5);

      expect(budget.queriesUsed).toBe(1);
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('AVL Tree Wikipedia');
      expect(results[0].url).toBe('https://en.wikipedia.org/wiki/AVL_tree');
    });
  });

  describe('safeFetchWebPage', () => {
    it('safely fetches allowed webpage and sanitizes HTML', async () => {
      const budget = createBudget();
      const htmlContent = '<html><head><title>CS Course</title></head><body><script>evil()</script><p>Data structures lecture notes with in-depth analysis of trees.</p></body></html>';

      vi.spyOn(mockValidator, 'validateUrl').mockResolvedValue({ valid: true });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => htmlContent,
      } as any);

      const source = await searchManager.safeFetchWebPage('https://cs.stanford.edu/notes.html', budget);

      expect(source).not.toBeNull();
      expect(source?.title).toBe('CS Course');
      expect(source?.fullText).toContain('Data structures lecture notes');
      expect(source?.fullText).not.toContain('evil()');
      expect(budget.sourcesFetched).toBe(1);
    });

    it('follows redirect safely if new target is valid', async () => {
      const budget = createBudget();
      const finalHtml = '<html><head><title>Final Page</title></head><body><p>Redirected content arrived safely with enough length to pass.</p></body></html>';

      vi.spyOn(mockValidator, 'validateUrl').mockResolvedValue({ valid: true });
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          status: 301,
          headers: new Headers({ location: 'https://cs.stanford.edu/final.html' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => finalHtml,
        } as any);

      const source = await searchManager.safeFetchWebPage('https://cs.stanford.edu/start.html', budget);
      expect(source).not.toBeNull();
      expect(source?.title).toBe('Final Page');
      expect(source?.url).toBe('https://cs.stanford.edu/final.html');
      expect(budget.sourcesFetched).toBe(1);
    });

    it('aborts redirect immediately if redirected to an SSRF or invalid domain', async () => {
      const budget = createBudget();
      vi.spyOn(mockValidator, 'validateUrl')
        .mockResolvedValueOnce({ valid: true })
        .mockResolvedValueOnce({ valid: false, reason: 'SSRF blocked' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data' }),
      } as any);

      const source = await searchManager.safeFetchWebPage('https://cs.stanford.edu/bounce', budget);
      expect(source).toBeNull();
      expect(budget.sourcesFetched).toBe(0);
    });
  });
});
