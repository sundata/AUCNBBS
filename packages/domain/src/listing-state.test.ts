import { describe, expect, it } from 'vitest';
import {
  canTransition,
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
