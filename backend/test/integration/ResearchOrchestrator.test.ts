import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ResearchOrchestratorService } from '../../src/services/ResearchOrchestratorService';
import { SearchManager } from '../../src/services/SearchManager';
import { UrlSecurityValidator } from '../../src/services/UrlSecurityValidator';
import { ResearchProposalStore } from '../../src/store/ResearchProposalStore';
import { KeyManager } from '../../src/services/KeyManager';

describe('ResearchOrchestratorService Integration Tests', () => {
  let validator: UrlSecurityValidator;
  let searchMgr: SearchManager;
  let proposalStore: ResearchProposalStore;
  let keyMgr: KeyManager;
  let orchestrator: ResearchOrchestratorService;

  beforeEach(() => {
    validator = new UrlSecurityValidator(['wikipedia.org', 'arxiv.org', '*.edu']);
    searchMgr = new SearchManager(validator);
    proposalStore = new ResearchProposalStore();
    keyMgr = new KeyManager([]); // mock mode
    orchestrator = new ResearchOrchestratorService(searchMgr, undefined as any, proposalStore, keyMgr);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('conducts bounded research, creates SourcedResearchReport, and verifies verbatim grounding', async () => {
    const wikiText =
      "Dijkstra's algorithm is an algorithm for finding the shortest paths between nodes in a weighted graph. It was conceived by computer scientist Edsger W. Dijkstra in 1956.";
    const arxivXml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2101.99999</id>
          <title>Fibonacci Heaps in Shortest Path Optimization</title>
          <summary>Using Fibonacci heaps reduces Dijkstra running time to O(E + V log V) in sparse networks.</summary>
          <author><name>Alan Turing</name></author>
        </entry>
      </feed>
    `;

    vi.spyOn(validator, 'validateUrl').mockResolvedValue({ valid: true, resolvedIp: '1.2.3.4' });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('wikipedia.org')) {
        return {
          ok: true,
          json: async () => ({
            title: "Dijkstra's algorithm",
            extract: wikiText,
            content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Dijkstra's_algorithm" } },
          }),
        } as any;
      }
      if (urlStr.includes('arxiv.org')) {
        return {
          ok: true,
          text: async () => arxivXml,
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const proposal = await orchestrator.executeTask(
      "What is the asymptotic complexity of Dijkstra's algorithm with Fibonacci heaps?",
      { maxQueries: 2, maxSources: 2 }
    );

    expect(proposal).toBeDefined();
    expect(proposal.id).toMatch(/^prop_/);
    expect(proposal.status).toBe('PENDING_REVIEW');

    // Sourced report validation
    expect(proposal.report.summary.length).toBeGreaterThan(20);
    expect(proposal.report.detailedAnalysis.length).toBeGreaterThan(20);
    expect(proposal.report.whatChangedAndWhy.length).toBeGreaterThan(20);
    expect(proposal.report.sources.length).toBeGreaterThanOrEqual(1);

    // Verbatim Grounding Invariant
    for (const ent of proposal.proposedEntities) {
      expect(ent.evidenceQuote.length).toBeGreaterThan(0);
      const matchedSource = proposal.report.sources.find((s) => s.id === ent.sourceId);
      expect(matchedSource).toBeDefined();
      const cleanSource = (matchedSource!.fullText || matchedSource!.snippet || '').replace(/\s+/g, ' ');
      const cleanQuote = ent.evidenceQuote.replace(/\s+/g, ' ');
      expect(cleanSource.toLowerCase()).toContain(cleanQuote.toLowerCase());
    }

    for (const rel of proposal.proposedRelations) {
      expect(rel.evidenceQuote.length).toBeGreaterThan(0);
      const matchedSource = proposal.report.sources.find((s) => s.id === rel.sourceId);
      expect(matchedSource).toBeDefined();
      const cleanSource = (matchedSource!.fullText || matchedSource!.snippet || '').replace(/\s+/g, ' ');
      const cleanQuote = rel.evidenceQuote.replace(/\s+/g, ' ');
      expect(cleanSource.toLowerCase()).toContain(cleanQuote.toLowerCase());
    }

    // Verify stored in proposalStore
    const retrieved = proposalStore.get(proposal.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(proposal.id);
  });

  it('respects hard budget constraints and stops fetching when maxSources is reached', async () => {
    let fetchCount = 0;
    vi.spyOn(validator, 'validateUrl').mockResolvedValue({ valid: true, resolvedIp: '1.2.3.4' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      fetchCount++;
      return {
        ok: true,
        json: async () => ({
          title: `Source Title ${fetchCount}`,
          extract: `Substantial extract body text number ${fetchCount} for testing source limits.`,
          content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/Page_${fetchCount}` } },
        }),
      } as any;
    });

    const proposal = await orchestrator.executeTask('Quantum key distribution', {
      maxQueries: 1,
      maxSources: 1,
    });

    expect(proposal.report.sources.length).toBeLessThanOrEqual(1);
  });

  it('gracefully handles zero sources retrieved without crashing', async () => {
    vi.spyOn(validator, 'validateUrl').mockResolvedValue({ valid: false, reason: 'Network down' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    const proposal = await orchestrator.executeTask('Nonexistent topic error handling', {
      maxQueries: 1,
      maxSources: 1,
    });

    expect(proposal.report.sources).toEqual([]);
    expect(proposal.proposedEntities).toEqual([]);
    expect(proposal.proposedRelations).toEqual([]);
    expect(proposal.report.summary).toContain('No reliable external sources');
  });
});
