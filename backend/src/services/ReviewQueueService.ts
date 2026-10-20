import { ReviewQueueItem } from '../types';
import { graphStore, GraphStore } from '../store/GraphStore';
import { reviewStore, ReviewStore } from '../store/ReviewStore';

export type ReviewResolutionAction = 'merge' | 'separate' | 'redirect';

export class ReviewQueueService {
  constructor(
    private graph: GraphStore = graphStore,
    private reviews: ReviewStore = reviewStore
  ) {}

  public listPending(): ReviewQueueItem[] {
    return this.reviews.getPending();
  }

  public get(id: string): ReviewQueueItem | undefined {
    return this.reviews.get(id);
  }

  public async resolve(
    id: string,
    action: ReviewResolutionAction,
    targetEntityId?: string
  ): Promise<void> {
    const item = this.reviews.get(id);
    if (!item) {
      throw new Error(`Review item ${id} not found`);
    }

    if (item.status !== 'pending') {
      throw new Error(`Review item ${id} has already been resolved as ${item.status}`);
    }

    const candidateId =
      item.candidateEntity.id ||
      this.graph.getEntityByName(item.candidateEntity.name)?.id;

    if (!candidateId) {
      throw new Error(`Candidate entity "${item.candidateEntity.name}" not found in graph`);
    }

    if (action === 'merge') {
      const matchedId = item.matchedEntity.id;
      this.graph.mergeEntities(candidateId, matchedId);
      this.reviews.resolve(id, 'accepted');
    } else if (action === 'separate') {
      this.graph.updateEntity(candidateId, { status: 'active' });
      this.reviews.resolve(id, 'rejected');
    } else if (action === 'redirect') {
      if (!targetEntityId) {
        throw new Error('targetEntityId is required for redirect action');
      }
      const targetEntity = this.graph.getEntity(targetEntityId);
      if (!targetEntity) {
        throw new Error(`Target entity ${targetEntityId} not found in graph`);
      }
      this.graph.mergeEntities(candidateId, targetEntityId);
      this.reviews.resolve(id, 'accepted');
    } else {
      throw new Error(`Unknown resolution action: ${action}`);
    }

    await Promise.all([this.graph.save(), this.reviews.save()]);
  }
}

export const reviewQueueService = new ReviewQueueService();
