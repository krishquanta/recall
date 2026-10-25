import { ResearchProposal } from '../types';

/**
 * In-memory store for research proposals pending user review.
 * Proposals auto-expire after 30 minutes (30 * 60 * 1000 ms).
 * Strictly distinct from ReviewStore (which handles entity dedup).
 */
export class ResearchProposalStore {
  private proposals: Map<string, ResearchProposal> = new Map();
  private expiryMs: number;

  constructor(expiryMs = 30 * 60 * 1000) {
    this.expiryMs = expiryMs;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, proposal] of this.proposals.entries()) {
      const createdTime = new Date(proposal.createdAt).getTime();
      if (!isNaN(createdTime) && now - createdTime > this.expiryMs) {
        this.proposals.delete(id);
      }
    }
  }

  public set(proposal: ResearchProposal): void {
    this.cleanup();
    this.proposals.set(proposal.id, proposal);
  }

  public get(proposalId: string): ResearchProposal | undefined {
    this.cleanup();
    return this.proposals.get(proposalId);
  }

  public delete(proposalId: string): boolean {
    return this.proposals.delete(proposalId);
  }

  public getAll(): ResearchProposal[] {
    this.cleanup();
    return Array.from(this.proposals.values());
  }

  public clear(): void {
    this.proposals.clear();
  }
}

export const researchProposalStore = new ResearchProposalStore();
