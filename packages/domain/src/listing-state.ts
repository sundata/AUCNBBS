import type { ListingStatus } from './enums.js';

export const LISTING_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['pending_review', 'active', 'archived'],
  pending_review: ['active', 'rejected', 'draft'],
  active: ['reserved', 'paused', 'completed', 'expired', 'removed'],
  reserved: ['active', 'completed', 'expired', 'removed'],
  paused: ['active', 'expired', 'archived', 'removed'],
  completed: ['archived'],
  expired: ['active', 'archived'],
  archived: [],
  rejected: ['draft', 'archived'],
  removed: [],
};

export const PUBLIC_LISTING_STATUSES: readonly ListingStatus[] = ['active', 'reserved'];

export function canTransition(from: ListingStatus, to: ListingStatus): boolean {
  return LISTING_TRANSITIONS[from].includes(to);
}

export class InvalidListingTransition extends Error {
  constructor(
    public readonly from: ListingStatus,
    public readonly to: ListingStatus,
  ) {
    super(`Cannot transition listing from ${from} to ${to}`);
    this.name = 'InvalidListingTransition';
  }
}

export function transition(from: ListingStatus, to: ListingStatus): ListingStatus {
  if (!canTransition(from, to)) throw new InvalidListingTransition(from, to);
  return to;
}

export function isPubliclyVisible(
  status: ListingStatus,
  expiresAt: Date,
  now = new Date(),
): boolean {
  return PUBLIC_LISTING_STATUSES.includes(status) && expiresAt.getTime() > now.getTime();
}
