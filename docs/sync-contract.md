# Duck Room: room-state synchronization contract

This document says how every browser in a room comes to show the same room. The code that
implements it is `server/realtime.ts` (server), `shared/protocol.ts` and `shared/sync.ts`
(shared types and rules) and `app/room/[code]/page.tsx` (browser). The tests are in
`tests/sync.test.ts` and `tests/schema.test.ts`. Every event and payload is listed in
[socket-events.md](socket-events.md).

## 1. The rule

The server holds the only true copy of a room. A browser never changes shared state by itself.
It sends a command, the server checks it, changes the room, and tells everyone.

```
browser  --command-->  server  --checks, changes room, version + 1-->  every browser in the room
```

## 2. Shared state and local state

| Shared (the server decides, everyone sees the same) | Local (this browser only, never sent) |
| --- | --- |
| Who is in the room, name, colour, wearables, held item | Volume, mute |
| Each duck's position, and whether its user is connected | Chat window position and open/closed |
| Owner, DJs, music control mode | Which panel or dialog is open |
| Music station, playing or paused, songs | Banner folded or dismissed |
| Scene and active event | Unread counter, sleeping after no activity |
| Chat messages, stickers and matches | Walk animation, facing direction |
| Carried krathong, floating krathongs | Typed but unsent text |

## 3. Snapshot

`room:snapshot` is the whole shared state of a room at one moment (`RoomState` in
`shared/protocol.ts`). The server sends it:

- as the answer to `room:join`;
- as the answer to `room:resume` (after a reconnect);
- as the answer to `room:resync`.

Right after each snapshot the same browser gets `chat:history` with the recent messages (at most 100).

A browser that receives a snapshot **replaces** everything it holds with it. It does not merge.
In-flight things from before (speech bubbles, sticker animations) are dropped.

Important fields: `roomId`, `version`, `versions { room, users, music, event, interactions, krathongs }`,
`users`, `ownerUserId`, `music`, `musicSettings`, `scene`, `event`, `krathongs`, `serverTime`.

## 4. Updates and the room version

Every change to shared state adds one to `room.version`. Every update the server sends about it
carries `roomVersion` (the version after the change) and `serverTime`.

A browser keeps the last version it applied and for each update does this
(`classifyVersion` in `shared/sync.ts`):

| Incoming `roomVersion` | Meaning | Action |
| --- | --- | --- |
| last + 1 | the next update | apply it |
| last or lower | old or repeated | ignore it |
| higher than last + 1 | an update was missed | apply nothing, send `room:resync`, wait for the snapshot |
| update about a user the browser does not know | an arrival was missed | same as a gap |

On join, the server publishes "user joined" before the new socket enters the room, then sends that
socket the snapshot. So the snapshot already contains the join, and the next update the new
browser sees is exactly `version + 1`.

Parts of the room also count their own changes: `usersVersion` (who is here, where, what they
carry, who may do what), `interactionVersion` (sticker matches), `krathongVersion`, and
`music.version`. An update carries the version of its part, and a snapshot carries all of them.
The browser uses the room version to find gaps, and for music keeps whichever state is newer.

## 5. Presence: reload and short disconnects

When a socket drops without `room:leave`, the duck is **not** removed. The server:

1. marks the user `connected: false` and sends `room:presence`;
2. waits `PRESENCE_GRACE_SECONDS` (default 30);
3. if the same session sends `room:resume` (or `room:join`) in time: the duck is connected again,
   the room gets `room:userJoined` for it, and that browser gets a snapshot. The duck keeps its position, items and role. No "left" or "joined"
   message appears in chat;
4. if not: the user is removed (`room:userLeft` with reason `TIMEOUT`) and a carried krathong is dropped.

The owner is handled by a separate timer. An owner who is not connected for `OWNER_GRACE_SECONDS`
(default 30) loses the room to the connected member who joined first (`room:ownerChanged`).

An away duck is drawn faded and asleep. It cannot be a sticker partner. Pressing **Exit** sends
`room:leave`, which removes the duck at once (reason `LEFT`).

One session is one duck. Opening the room in a second tab moves the duck to the new tab.

## 6. Commands that are safe to repeat

Commands that change shared things carry a `commandId` (a UUID the browser makes with
`newCommandId()`). The server remembers, for 60 seconds per user, the ids it has carried out and
the answer each one got. A second command with the same id is **not** carried out again; the sender
gets the first answer again.

Every command in the core list carries one: `room:create`, `room:leave`, `music:play`,
`music:pause`, `music:next`, `music:station`, `music:permission:*`, `krathong:pickup`,
`krathong:release`. Chat uses `clientMessageId` the same way. Moves carry `clientMoveId`, which the
server sends back in `duck:moved` so the browser can match its own move. `POST /api/rooms` takes
the id in the `x-command-id` header.

## 7. Movement

- The browser sends `duck:move { clientMoveId, destination: { x, y } }`.
- It draws its own duck walking at once (prediction). This is drawing only.
- The server checks the move (limits, rate, not locked by a sticker match), stores the destination
  and publishes `duck:moved { userId, clientMoveId, serverMoveId, from, destination, direction, startedAt, durationMs }`
  and answers `{ serverMoveId }`.
- If the server refuses, the acknowledgement is `{ ok: false }` and the browser puts the duck back
  where the server last said it was.
- Only destinations are sent, never positions per frame. Each browser animates the walk.

Floating krathongs work the same way: the server sends the release time and path once, and every
browser computes the position from the shared clock (`serverTime` gives the clock difference).

## 8. Events

The full list, with payloads, limits and errors, is in [socket-events.md](socket-events.md). That
document also lists where Duck Room differs from the written specification.

## 9. Checklist

- [x] A new browser gets one snapshot and shows the same room as the others
- [x] Every shared change raises the room version by one and carries it
- [x] Old and repeated updates are ignored
- [x] A missed update causes a resync, not a wrong screen
- [x] Reload or a short network loss keeps the duck, position, items and role
- [x] After the grace period the user is removed; an absent owner is replaced
- [x] A repeated command is carried out once
- [x] The server can refuse a predicted move and the browser follows the server
- [x] Local settings (volume, window position) are never shared
- [x] All of the above is tested in `tests/sync.test.ts`
