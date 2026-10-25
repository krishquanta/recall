import { describe, it, expect, beforeEach } from 'vitest';
import { ResearchProposalStore } from '../../src/store/ResearchProposalStore';
import { ResearchProposal } from '../../src/types';

describe('ResearchProposalStore Unit Tests', () => {
  let store: ResearchProposalStore;

  const createDummyProposal = (id: string, ageMs = 0): ResearchProposal => ({
    id,
    report: {
      id: `rep_${id}`,
      taskId: `task_${id}`,
      question: `Topic question for ${id}`,
      summary: 'Summary text',
      detailedAnalysis: 'Analysis text',
      whatChangedAndWhy: 'Delta text',
      sources: [],
      generatedAt: new Date(Date.now() - ageMs).toISOString(),
    },
    proposedEntities: [],
    proposedRelations: [],
    proposedResolutions: [],
    status: 'PENDING_REVIEW',
    createdAt: new Date(Date.now() - ageMs).toISOString(),
  });

  beforeEach(() => {
    store = new ResearchProposalStore(1000); // 1-second TTL for testing
  });

  it('stores and retrieves a research proposal by id', () => {
    const prop = createDummyProposal('prop_1');
    store.set(prop);

    const retrieved = store.get('prop_1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('prop_1');
    expect(retrieved?.status).toBe('PENDING_REVIEW');
  });

  it('returns undefined for non-existent proposal id', () => {
    expect(store.get('prop_nonexistent')).toBeUndefined();
  });

  it('deletes proposal cleanly when delete() is invoked', () => {
    const prop = createDummyProposal('prop_del');
    store.set(prop);
    expect(store.get('prop_del')).toBeDefined();

    const deleted = store.delete('prop_del');
    expect(deleted).toBe(true);
    expect(store.get('prop_del')).toBeUndefined();
  });

  it('lists all active non-expired proposals', () => {
    store.set(createDummyProposal('prop_a'));
    store.set(createDummyProposal('prop_b'));

    const all = store.getAll();
    expect(all.length).toBe(2);
    expect(all.map((p) => p.id)).toContain('prop_a');
    expect(all.map((p) => p.id)).toContain('prop_b');
  });

  it('lazily cleans up and evicts proposals that exceed TTL expiry', () => {
    // Proposal created 2 seconds ago with 1 second TTL
    const expiredProp = createDummyProposal('prop_expired', 2000);
    store.set(expiredProp);

    // Active proposal
    const freshProp = createDummyProposal('prop_fresh', 0);
    store.set(freshProp);

    // Directly access get on expired proposal
    expect(store.get('prop_expired')).toBeUndefined();

    // getAll should only contain fresh proposal
    const all = store.getAll();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('prop_fresh');
  });

  it('clears all proposals on clear()', () => {
    store.set(createDummyProposal('p1'));
    store.set(createDummyProposal('p2'));
    expect(store.getAll().length).toBe(2);

    store.clear();
    expect(store.getAll().length).toBe(0);
  });
});
