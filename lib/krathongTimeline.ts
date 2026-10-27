// Which krathongs are on the river right now, for one room, in this browser.
// The server says once when a krathong touches the water and when its time is up. This keeps the
// list in step with those two moments, and owns every timer it starts: when the room's state is
// replaced, a krathong is removed, or the page leaves the room, its timers are cancelled, so
// nothing from before can show up later.
import type { FloatingKrathong } from "@/shared/interactions";

type Timer = ReturnType<typeof setTimeout>;
type Clock = { set: (run: () => void, ms: number) => Timer; clear: (timer: Timer) => void };

export function createKrathongTimeline(
  /** Called with the new list whenever what is on the water changes. */
  onChange: (afloat: FloatingKrathong[]) => void,
  /** The server's clock, as well as this browser can tell. */
  serverNow: () => number,
  clock: Clock = { set: (run, ms) => setTimeout(run, ms), clear: (timer) => clearTimeout(timer) },
) {
  const afloat = new Map<string, FloatingKrathong>();
  const timers = new Map<string, Timer[]>();
  let disposed = false;

  const emit = () => !disposed && onChange([...afloat.values()]);
  const cancel = (id: string) => {
    for (const timer of timers.get(id) ?? []) clock.clear(timer);
    timers.delete(id);
  };

  /** Starts following one krathong. Returns whether the list changed right away. */
  const follow = (krathong: FloatingKrathong) => {
    cancel(krathong.id);
    const now = serverNow();
    if (krathong.expiresAt <= now) return afloat.delete(krathong.id);

    const own = [
      clock.set(() => {
        timers.delete(krathong.id);
        if (afloat.delete(krathong.id)) emit();
      }, krathong.expiresAt - now),
    ];
    // Not on the water yet: the duck is still setting it down.
    if (krathong.createdAt > now) {
      own.push(
        clock.set(() => {
          afloat.set(krathong.id, krathong);
          emit();
        }, krathong.createdAt - now),
      );
    }
    timers.set(krathong.id, own);
    if (krathong.createdAt > now) return afloat.delete(krathong.id);
    afloat.set(krathong.id, krathong);
    return true;
  };

  return {
    /** A snapshot arrived: forget everything and follow exactly the krathongs it lists. */
    reset(list: readonly FloatingKrathong[]) {
      for (const id of [...timers.keys()]) cancel(id);
      afloat.clear();
      list.forEach(follow);
      emit();
    },
    /** `krathong:spawned` */
    spawn(krathong: FloatingKrathong) {
      if (follow(krathong)) emit();
    },
    /** `krathong:removed`. Safe to repeat, and it also stops one that has not appeared yet. */
    remove(id: string) {
      cancel(id);
      if (afloat.delete(id)) emit();
    },
    /** Leaving the room: stop every timer and report nothing more. */
    dispose() {
      disposed = true;
      for (const id of [...timers.keys()]) cancel(id);
      afloat.clear();
    },
    /** How many timers are waiting. For tests. */
    pending: () => [...timers.values()].reduce((sum, own) => sum + own.length, 0),
  };
}
