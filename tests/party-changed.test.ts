/**
 * Regression test for the party sync "changed" detection bug.
 *
 * Bug: applyPartyRoom decided whether to rebind media purely from
 * queue pointer (track().id !== target.id). After a local next(), the
 * heartbeat could return the room's new state BEFORE the local write
 * settled; syncPartyQueue had already rewritten queue[0] to the new id,
 * so `changed` evaluated false and loadCurrent/seek never ran — the
 * member stayed stuck on the previous track's audio element forever.
 *
 * Fix: changed also requires loadedTrackId === target.id, i.e. the audio
 * element must actually be bound to the room's track.
 *
 * These tests exercise the decision boundary through a minimal harness:
 * we can't import store.ts directly in happy-dom without the whole player
 * stack (Audio element etc.), so we replicate the exact guard block and
 * pin its contract. The real-world failure mode was verified live in the
 * browser (host tab stalled with track()=1843028944 but audio.src=255249).
 */
import { describe, it, expect } from 'vitest';

interface HarnessState {
  localQueueHeadId: string | null;
  loadedTrackId: string | null;
  syncing: boolean;
  rebound: Array<{ id: string; seekTo?: number; play: boolean }>;
}

/** Exact replica of the pre-fix and post-fix guard logic. */
function decideChanged(
  state: HarnessState,
  targetId: string,
  variant: 'pre' | 'post',
): boolean {
  const local = state.localQueueHeadId;
  if (variant === 'pre') {
    return !local || local !== targetId;
  }
  return !local || local !== targetId || state.loadedTrackId !== targetId;
}

describe('party applyPartyRoom changed-detection', () => {
  it('pre-fix: stale media binding with matching queue id skips rebind (the bug)', () => {
    // State right after a host next(): queue head already points at the new
    // track, but loadCurrent hasn't rebound the audio element yet.
    const state: HarnessState = {
      localQueueHeadId: '1843028944',
      loadedTrackId: '255249',
      syncing: false,
      rebound: [],
    };
    expect(decideChanged(state, '1843028944', 'pre')).toBe(false); // ← stall
  });

  it('post-fix: stale media binding with matching queue id triggers rebind', () => {
    const state: HarnessState = {
      localQueueHeadId: '1843028944',
      loadedTrackId: '255249',
      syncing: false,
      rebound: [],
    };
    expect(decideChanged(state, '1843028944', 'post')).toBe(true);
  });

  it('post-fix: fully-bound current track does not spuriously rebind', () => {
    const state: HarnessState = {
      localQueueHeadId: '255249',
      loadedTrackId: '255249',
      syncing: false,
      rebound: [],
    };
    expect(decideChanged(state, '255249', 'post')).toBe(false);
  });

  it('post-fix: empty queue always counts as changed', () => {
    const state: HarnessState = {
      localQueueHeadId: null,
      loadedTrackId: 'anything',
      syncing: false,
      rebound: [],
    };
    expect(decideChanged(state, '255249', 'post')).toBe(true);
  });
});
