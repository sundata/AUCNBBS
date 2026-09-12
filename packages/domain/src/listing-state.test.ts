import { describe, expect, it } from 'vitest';
import {
  canTransition,
  effectiveListingStatus,
  isPubliclyVisible,
  transition,
  InvalidListingTransition,
} from './listing-state.js';

describe('listing state machine', () => {
  it('allows the happy path draft → active → completed → archived', () => {
    let s = transition('draft', 'active');
    s = transition(s, 'completed');
    s = transition(s, 'archived');
    expect(s).toBe('archived');
  });

  it('rejects skipping to completed from draft', () => {
    expect(() => transition('draft', 'completed')).toThrow(InvalidListingTransition);
  });

  it('allows renewing an expired listing', () => {
    expect(canTransition('expired', 'active')).toBe(true);
  });

  it('archived and removed are terminal', () => {
    expect(canTransition('archived', 'active')).toBe(false);
    expect(canTransition('removed', 'active')).toBe(false);
  });

  it('hides expired-but-active rows from public', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000);
    expect(isPubliclyVisible('active', past)).toBe(false);
    expect(isPubliclyVisible('active', future)).toBe(true);
    expect(isPubliclyVisible('draft', future)).toBe(false);
  });
});

describe('effective expiry', () => {
  const now = new Date('2026-09-12T00:00:00Z');
  it('expires exactly at the deadline', () => {
    expect(effectiveListingStatus('active', now, now)).toBe('expired');
    expect(effectiveListingStatus('active', new Date(now.getTime() + 1), now)).toBe('active');
  });
  it('preserves terminal states even after the deadline', () => {
    expect(effectiveListingStatus('completed', now, now)).toBe('completed');
    expect(effectiveListingStatus('removed', now, now)).toBe('removed');
  });
});
