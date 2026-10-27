# Duck Room: Socket.IO event schema

This is the full list of what travels over the socket. The source of truth is the code:

| File | Holds |
| --- | --- |
| `shared/socket/client-events.ts` | `ClientToServerEvents`, payload types, `CLIENT_EVENTS` (the allowlist) |
| `shared/socket/server-events.ts` | `ServerToClientEvents`, payload types |
| `shared/socket/acknowledgements.ts` | `SocketAck`, result types |
| `shared/socket/errors.ts` | `SocketErrorCode`, `SocketError`, `SocketErrorPayload` |
| `shared/protocol.ts` | Zod schemas, `RoomState`, `RoomUser`, `MusicState`, `RoomVersions` |
| `shared/interactions.ts`, `shared/stickers.ts`, `shared/cosmetics.ts`, `shared/events.ts` | schemas and types of each feature |
| `shared/sync.ts` | the client's version rules, `newCommandId()` |

The browser (`app/room/[code]/page.tsx`) and the server (`server/realtime.ts`) import the same
files. TypeScript checks both at build time; Zod checks every incoming payload at run time,
because data from the network cannot be trusted whatever its type says. How snapshots and versions
keep browsers in step is in [sync-contract.md](sync-contract.md).

## Rules

1. **A payload carries intent, never identity.** The acting user is the session's user
   (`socket.data.session.userId`, set by the connection middleware from the signed cookie).
   Self-actions have no `userId`. Roles are read from the room, never from the payload.
2. **Schemas are strict.** An unknown field (`userId`, `role`, `isOwner`, `isDJ`, `speed`, …) makes
   the whole payload `INVALID_PAYLOAD`.
3. **A target user id is allowed only where the action is about someone else**: `music:permission:addDJ`
   and `removeDJ` (the server still checks that the sender is the owner and the target is in the room),
   and `voice:signal` (both must be in this room's voice chat).
4. **Names** are `namespace:action`. **Fields** are camelCase. **Times** are Unix milliseconds
   (`createdAt`, `startedAt`, `endsAt`, `expiresAt`, `serverTime`).
5. **Positions** are `{ x, y }`, both from 0 to 1.
6. **Payloads are small**: at most 16 KB per event, and only a voice chat's session descriptions
   come near that. No images, audio or configs travel on updates.

## Every command goes through the same steps

```
payload validation (Zod)  →  session (checked on connect)  →  room membership  →  authorization
→  rate limit  →  repeated command?  →  state checks  →  change  →  version + 1
→  acknowledgement  →  update to the room
```

This is `on()` in `server/realtime.ts`. A handler cannot skip a step.

## Acknowledgement

```ts
type SocketAck<T> =
  | { ok: true; commandId?: string; data?: T }
  | { ok: false; commandId?: string; error: { code: SocketErrorCode; message: string; retryAfterMs?: number } };
```

An acknowledgement says whether the command was accepted. Shared state still arrives as server
events. A command sent without an acknowledgement callback gets its error as `socket:error`
(except a rate-limited `duck:move`, which is dropped quietly).

## Error codes

| Code | Meaning |
| --- | --- |
| `INVALID_PAYLOAD` | Failed validation: wrong type, out of range, unknown field, unknown event |
| `UNAUTHENTICATED` | No valid session (also the connection error for a missing or forged cookie) |
| `FORBIDDEN` | In the room, but not allowed: not the owner, not a DJ, a locked wearable |
| `ROOM_NOT_FOUND` | No room with that code (the same answer for "never existed" and "closed") |
| `ROOM_FULL` | The room has `MAX_ROOM_USERS` ducks, or its voice chat has `MAX_VOICE_USERS` |
| `NOT_IN_ROOM` | The command needs a room and this connection is not in one |
| `INVALID_STATE` | Well formed, but not possible now: duck is busy, nothing to release, unknown station |
| `TOO_FAR` | The duck is not standing at the zone |
| `RATE_LIMITED` | Too many, too fast. `retryAfterMs` says how long to wait when the server knows |
| `EVENT_INACTIVE` | The seasonal event this belongs to is not on (krathongs, seasonal stickers) |
| `OBJECT_NOT_FOUND` | The zone, krathong design, track or target user does not exist here |
| `CONFLICT` | Already in a room; replaced by another tab; no space for a new room |
| `VERSION_MISMATCH` | Reserved. Not sent yet |
| `INTERNAL_ERROR` | Something broke. Details are only in the server log |

Messages are short and written for a person. They never contain stack traces, file paths or secrets.

## Client → server

`commandId`, `clientMoveId` and `clientMessageId` are UUIDs made by the browser (`newCommandId()`).

| Event | Payload | Who | Limit | Answer `data` | Room sees | Errors (besides `INVALID_PAYLOAD`, `RATE_LIMITED`) |
| --- | --- | --- | --- | --- | --- | --- |
| `room:create` | `{ commandId, displayName, duckColor }` | session | 5 / min, 20 / hour / IP | `{ roomId, roomCode }` | – | `CONFLICT` |
| `room:join` | `{ roomCode, displayName, duckColor, heldItem?, equipment? }` | session | 10 / min, 30 / min / IP | – | `room:userJoined`, system `chat:message`; to you: `room:snapshot`, `chat:history` | `ROOM_NOT_FOUND`, `ROOM_FULL`, `CONFLICT` |
| `room:resume` | `{ roomCode, lastKnownVersions? }` | session whose duck the room still holds | same as join | – | `room:userJoined` (connected again); to you: `room:snapshot`, `chat:history` | `ROOM_NOT_FOUND`, `NOT_IN_ROOM`, `CONFLICT` |
| `room:resync` | `{ roomCode, reason }`, reason is `VERSION_GAP`, `UNKNOWN_OBJECT`, `RECONNECT` or `MANUAL` | member | 5 / 10 s | – | to you: `room:snapshot`, `chat:history` | `NOT_IN_ROOM` |
| `room:leave` | `{ commandId }` | member | – | – | `room:userLeft` (`LEFT`), system `chat:message` | `NOT_IN_ROOM` |
| `duck:move` | `{ clientMoveId, destination: { x, y } }` | member | 20 / s | `{ serverMoveId }` | `duck:moved` | `NOT_IN_ROOM`, `INVALID_STATE` (busy) |
| `chat:message` | `{ clientMessageId, text }`, 1–300 characters, plain text | member | 5 / 5 s and 20 / min | `{ messageId }` | `chat:message` | `NOT_IN_ROOM` |
| `sticker:send` | `{ stickerId }` | member | 1 / s and 10 / min | – | `sticker:sent`, and `sticker:match` when it completes a pair | `NOT_IN_ROOM`, `EVENT_INACTIVE` |
| `krathong:pickup` | `{ commandId, stallId, variant }` | member at the stall | 4 / min | – | `duck:stateChanged` (now carrying) | `EVENT_INACTIVE`, `OBJECT_NOT_FOUND`, `TOO_FAR`, `INVALID_STATE` |
| `krathong:release` | `{ commandId, zoneId }` | member carrying one, at the river | 4 / min, and the event's cooldown | `{ krathongId, interactionId }` | `duck:stateChanged` (releasing), `krathong:spawned`, maybe `krathong:removed` | same |
| `music:play`, `music:pause` | `{ commandId }` | music control | 5 / 10 s | – | `music:state` | `NOT_IN_ROOM`, `FORBIDDEN` |
| `music:next` | `{ commandId }` | music control | 3 / 10 s | – | `music:state` | same |
| `music:station` | `{ commandId, stationId }` | music control | 3 / 10 s | – | `music:state` | same, and `INVALID_STATE` for an id the server does not have. A URL is never accepted |
| `music:permission:setMode` | `{ commandId, mode }`, mode is `OWNER_ONLY`, `DJ_ONLY` or `EVERYONE` | owner | 20 / 10 s | – | `music:permissions`, system `chat:message` | `NOT_IN_ROOM`, `FORBIDDEN` |
| `music:permission:addDJ`, `music:permission:removeDJ` | `{ commandId, targetUserId }` | owner | 20 / 10 s | – | `music:permissions` | `NOT_IN_ROOM`, `FORBIDDEN`, `OBJECT_NOT_FOUND` |

Voice chat. The sound goes directly between browsers (WebRTC) and never reaches the server:

| Event | Payload | Who | Limit | Answer `data` | Room sees | Errors (besides `INVALID_PAYLOAD`, `RATE_LIMITED`) |
| --- | --- | --- | --- | --- | --- | --- |
| `voice:join` | `{ muted }` | member | 6 / 10 s | `{ peers, iceServers }`: who is already in, and the STUN / TURN servers to use | `voice:state` (joined). Joining again first sends `voice:state` (left), so the others drop the old connection | `NOT_IN_ROOM`, `ROOM_FULL` |
| `voice:leave` | – | member | – | – | `voice:state` (left) | `NOT_IN_ROOM` |
| `voice:mute` | `{ muted }`, your own microphone | member in the voice chat | 20 / 10 s | – | `voice:state` | `NOT_IN_ROOM`, `INVALID_STATE` |
| `voice:signal` | `{ to, signal }`, signal is `{ type: "offer" \| "answer", sdp }` or `{ type: "candidates", candidates[] }` (at most 16) | member in the voice chat, to another one | 200 / 10 s | – | `voice:signal { from, signal }`, to that duck only | `NOT_IN_ROOM`, `OBJECT_NOT_FOUND` |

Duck Room features outside the core list:

| Event | Payload | Who | Limit | Room sees |
| --- | --- | --- | --- | --- |
| `duck:item` | `{ heldItem }` | member | 10 / 10 s | `duck:item` |
| `cosmetic:equip` | `{ slot, wearableId }` | member who has it unlocked | 10 / 10 s | `duck:appearance` |
| `cosmetic:unequip` | `{ slot }` | member | 10 / 10 s | `duck:appearance` |
| `room:scene` | `{ scene }` | owner | 20 / 10 s | `room:settingsChanged`, system `chat:message` |
| `music:removeTrack` | `{ trackId }` | owner | 20 / 10 s | `music:state` |
| `music:requestDJ` | – | member | 1 / 30 s | `music:djRequest`, to the owner only |

### Who may do what

| Event | Member | DJ | Owner |
| --- | --- | --- | --- |
| `duck:move`, `chat:message`, `sticker:send`, `krathong:pickup`, `krathong:release`, `voice:*` | ✓ | ✓ | ✓ |
| `music:play`, `music:pause`, `music:next`, `music:station` | only in `EVERYONE` mode | in `DJ_ONLY` and `EVERYONE` mode | ✓ |
| `music:permission:*`, `room:scene`, `music:removeTrack` | ✗ | ✗ | ✓ |

The one rule for music is `canControlMusic()` in `shared/protocol.ts`. The server decides with it;
the browser only uses it to choose which buttons to show.

## Server → client

Every update to shared state carries `roomVersion` and `serverTime`. Updates about the people in
the room also carry `usersVersion`; matches carry `interactionVersion`; krathongs carry
`krathongVersion`; music carries `state.version`.

| Event | Payload (without the version fields) |
| --- | --- |
| `room:snapshot` | `RoomState`: `roomId`, `code`, `createdAt`, `version`, `versions { room, users, music, event, interactions, krathongs }`, `selfId`, `ownerUserId`, `scene`, `users[]`, `music`, `musicSettings`, `stations`, `event`, `inventory` (yours only), `krathongs[]`, `voice[]` (`{ userId, muted }`), `serverTime`. To one browser |
| `chat:history` | `{ messages, serverTime }`, at most 100. To one browser, right after each snapshot |
| `room:userJoined` | `{ user }` |
| `room:userLeft` | `{ userId, reason }`, reason is `LEFT`, `DISCONNECTED`, `TIMEOUT` (`KICKED` is reserved) |
| `room:presence` | `{ userId, connected }`: the connection dropped or came back, and the duck is still in the room |
| `room:ownerChanged` | `{ previousOwnerUserId, ownerUserId }` |
| `room:settingsChanged` | `{ settings: { scene } }` |
| `duck:moved` | `{ userId, clientMoveId?, serverMoveId, from, destination, direction, startedAt, durationMs }` |
| `duck:stateChanged` | `{ userId, activity, carriedItem, interactionId?, startedAt?, endsAt? }`. `activity` is `idle` or `releasing-krathong` today |
| `duck:item` | `{ userId, heldItem }` |
| `duck:appearance` | `{ userId, appearance: { color, equipment } }` |
| `chat:message` | `{ message, clientMessageId? }` |
| `sticker:sent` | `{ stickerEventId, userId, stickerId, createdAt }` |
| `sticker:match` | `{ interactionId, stickerId, interactionType, userA, userB, startedAt, durationMs, mode, positions? }`. Do not start it if server time is already past `startedAt + durationMs` |
| `music:state` | `{ state: { stationId, playing, changedAt, changedByUserId, version, tracks } }`. Volume and mute are local and never sent |
| `music:permissions` | `{ mode, djUserIds }` |
| `voice:state` | `{ userId, joined, muted }`: a duck joined or left the voice chat, or switched its microphone |
| `krathong:spawned` | `{ krathong, interactionId }`. Sent once; the browser works out the position from start, drift, speed and time |
| `krathong:removed` | `{ krathongId, reason }`, reason is `ROOM_CLEANUP` or `EVENT_ENDED`. Expiry needs no message: every browser knows `expiresAt` |
| `event:state`, `event:started`, `event:updated`, `event:ended` | The seasonal event, the same for all rooms, with its own version |
| `cosmetic:inventory` | `{ wearableIds }`. To one user |
| `music:djRequest` | `{ userId }`. To the owner only |
| `voice:signal` | `{ from, signal }`. To one user. `from` is set by the server |
| `socket:error` | `{ error, event?, serverTime }` |

### Releasing a krathong is one step

```
check command → duck is locked → carriedItem removed → krathong created
→ users version + 1, krathong version + 1
→ duck:stateChanged { activity: "releasing-krathong", interactionId, startedAt, endsAt }
→ krathong:spawned  { krathong, interactionId }
→ acknowledgement   { krathongId, interactionId }
```

The same `interactionId` is in all three.

### Joining the voice chat

```
voice:join { muted }            → answer { peers: [everyone already in], iceServers }
                                → the room sees voice:state { userId, joined: true, muted }
for each peer, the newcomer:    voice:signal { to: peer, signal: offer }
each peer answers:              voice:signal { to: newcomer, signal: answer }
both, as they find paths:       voice:signal { to, signal: candidates }
→ the two browsers are connected and the server is out of the picture
```

Only the newcomer calls, so two offers never cross. A duck whose connection to the server drops
is taken out of the voice chat at once (`voice:state`, left), even while the duck itself is held
for the grace period; its browser joins again after the snapshot that follows the reconnect.
Who is speaking is never sent: each browser works it out from the sound it receives.

## Reconnect

```
socket connects again (the session cookie is checked)
→ room:resume { roomCode }
→ the server finds the duck it kept for this session, marks it connected
→ room:snapshot + chat:history
→ the browser replaces everything it held
```

If the room no longer holds the duck (`NOT_IN_ROOM`), the browser sends `room:join` instead.
Nothing is replayed; a fresh snapshot is simpler and cannot be wrong.

## Where this differs from the written specification

| Specification | Duck Room | Why |
| --- | --- | --- |
| `packages/shared`, `apps/web`, `apps/server` | One app; the contract is in `shared/socket/` and `shared/*.ts` | Your earlier choice: keep the single app |
| Redis and PostgreSQL | Rooms in memory behind `RoomRepository`; the command memory is a map | Same choice. Both are the places to change for several servers |
| Snapshot `{ room: { users: Record, … }, versions, serverTime }` | A flat `RoomState` with `users[]` and `versions` | The page and 135 tests read this shape; the content is the same |
| `RoomUserState` with `position`, `direction`, `activity`, `permissions` | `RoomUser` with `x`, `y`. Direction and activity travel in `duck:moved` and `duck:stateChanged`; owner and DJs are in the snapshot once | Nothing is stored twice |
| Only `roomCode` in join | Also optional `heldItem`, `equipment` | Existing features; the server still checks them |
| The page creates rooms with `room:create` | The server supports `room:create`; the home page still uses `POST /api/rooms` | The home page has no socket. Both paths use the same limits and are safe to repeat |
| `event:*` payloads `{ event, eventVersion, serverTime }` | The existing `EventSnapshot` (`{ state: { eventId, slug, version, … }, event }`), plus `event:updated` | Built with the event system; it already has its own version |
| Events only from the list | Also `voice:*`, `room:presence`, `duck:item`, `duck:appearance`, `cosmetic:*`, `room:scene`, `music:removeTrack`, `music:requestDJ`, `music:djRequest` | Features the list does not cover |
| `krathong:removed` reasons `EXPIRED`, `OUT_OF_BOUNDS` | Not sent | Browsers remove an expired krathong by its `expiresAt` |

## Checklist

- [x] The browser and the server use one event definition (`tests/schema.test.ts` checks nothing else declares one)
- [x] Every incoming payload is validated at run time, with strict schemas
- [x] Self-actions carry no user id; a fake one is rejected
- [x] Authorization is decided on the server from the room's own record
- [x] The snapshot and every update are typed
- [x] Versions detect stale and missing updates
- [x] Reconnect uses a fresh snapshot (`room:resume`)
- [x] Music permission modes are enforced
- [x] Sticker matches are made by the server
- [x] Krathong pickup and release are decided by the server
- [x] Floating objects send nothing while they drift
- [x] Command ids prevent a repeat from acting twice
- [x] Each kind of event has its own rate limit
- [x] Errors use one list of codes
- [x] No session data enters room state
- [x] The security and synchronization tests pass (`npm test`)
