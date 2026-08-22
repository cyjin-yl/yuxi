/**
 * Regression test for the guest ghost-room bug.
 *
 * Bug: partyPoll caught ALL heartbeat errors and swallowed them, so a
 * guest whose room vanished server-side (24h alarm cleanup, host
 * deletion) polled a 404 every 2.5s forever with no UI feedback —
 * stuck in a dead room.
 *
 * Fix (store.ts partyPoll): on err.message === 'party_404' call
 * void this.leaveParty(); any other error retries silently next tick.
 *
 * The server side of the contract (DO answers 404 room_not_found after
 * cleanup) is pinned in party-do.test.ts; party.ts translates !res.ok
 * into throw Error(`party_${status}`). What was uncovered is the client
 * decision itself. Like party-changed.test.ts we can't import store.ts
 * in happy-dom without the whole player stack (Audio element etc.), so
 * we replicate the exact guard block in a minimal harness and pin its
 * contract.
 */
import { describe, it, expect } from 'vitest';

/** Minimal harness mirroring store.ts's party state fields + actions. */
function makeHarness(heartbeatImpl: () => Promise<unknown>) {
  const calls = { heartbeat: 0, leave: 0, apply: 0 };
  const h = {
    partyRoom: { code: 'KAPJ' } as { code: string } | null,
    partyTimer: setInterval(() => void h.partyPoll(), 1) as unknown as number | null,
    partyPollPending: false,
    unhandledRejections: [] as unknown[],
    ...calls,
    async applyPartyRoom() {
      h.apply += 1;
    },
    async leaveParty() {
      h.partyRoom = null;
      if (h.partyTimer !== null) {
        clearInterval(h.partyTimer);
        h.partyTimer = null;
      }
      // Mirrors store.ts: leaveRoom failure (room already gone) must be
      // caught here, or `void this.leaveParty()` becomes an unhandled
      // rejection.
      try {
        await Promise.reject(new Error('party_404'));
      } catch {
        /* room may already be gone */
      }
      h.leave += 1;
    },
    /** Exact replica of the post-fix partyPoll guard block. */
    async partyPoll(): Promise<void> {
      const room = h.partyRoom;
      if (!room || h.partyPollPending) return;
      h.partyPollPending = true;
      try {
        await heartbeatImpl();
        await h.applyPartyRoom();
      } catch (err) {
        // Room gone (alarm cleanup, host deleted it) — leave cleanly so
        // the UI resets instead of polling a 404 forever. Transient
        // network errors just retry on the next tick.
        if (err instanceof Error && err.message === 'party_404') {
          void h.leaveParty();
        }
      } finally {
        h.partyPollPending = false;
      }
    },
  };
  process.on('unhandledRejection', (e) => h.unhandledRejections.push(e));
  return h;
}

describe('partyPoll ghost-room self-heal', () => {
  it('post-fix: party_404 from heartbeat leaves the room once and stops polling', async () => {
    let n = 0;
    const h = makeHarness(async () => {
      n += 1;
      if (n >= 2) throw new Error('party_404');
    });
    // tick 1: healthy poll; tick 2: room gone -> auto-leave
    await h.partyPoll();
    expect(h.leave).toBe(0);
    await h.partyPoll();
    // leaveParty is fire-and-forget; give the microtask chain a beat
    await new Promise((r) => setTimeout(r, 10));
    expect(h.leave).toBe(1);
    expect(h.partyRoom).toBeNull();
    expect(h.partyTimer).toBeNull();
    // tick 3+: no room, no pending flag leak — poll is a no-op, heartbeat untouched
    const heartbeatsAtLeave = n;
    await h.partyPoll();
    await h.partyPoll();
    expect(n).toBe(heartbeatsAtLeave);
    expect(h.partyPollPending).toBe(false);
    expect(h.unhandledRejections).toHaveLength(0);
  });

  it('post-fix: transient errors retry instead of leaving', async () => {
    let n = 0;
    const h = makeHarness(async () => {
      n += 1;
      if (n === 1) throw new TypeError('Failed to fetch');
      if (n === 2) throw new Error('party_502');
    });
    await h.partyPoll();
    await new Promise((r) => setTimeout(r, 10));
    await h.partyPoll();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.leave).toBe(0);
    expect(h.partyRoom).not.toBeNull();
    expect(h.partyTimer).not.toBeNull();
    clearInterval(h.partyTimer as number);
  });

  it('pre-fix replica: swallow-all catch never leaves (the bug)', async () => {
    let left = false;
    const h = {
      partyRoom: { code: 'KAPJ' } as { code: string } | null,
      leave() {
        left = true;
      },
      async partyPoll(): Promise<void> {
        try {
          await Promise.reject(new Error('party_404'));
        } catch {
          /* old code: swallow everything */
        }
      },
    };
    await h.partyPoll();
    expect(left).toBe(false); // ← guest polls a 404 forever
  });

  it('post-fix: pending flag stays false when heartbeat throws', async () => {
    const h = makeHarness(async () => {
      throw new Error('party_404');
    });
    await h.partyPoll();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.partyPollPending).toBe(false);
  });
});
