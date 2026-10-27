# Duck Room 🦆

A cozy group chat room. Every user is an animated duck, and the room plays shared lofi music.
There is no sign-up, but the server still decides who everyone is and what they may do.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:3000. One command starts everything: the Next.js pages and the Socket.IO
server run in the same Node process on the same port. To use another port: `PORT=4000 npm run dev`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start in development mode |
| `npm test` | Run the security tests against a real server |
| `npm run typecheck` | Type-check the whole project |
| `npm run share` | Share your local copy with friends through a Cloudflare tunnel |
| `npm run build` then `npm start` | Production build and start |

## How it works for users

- **Rooms** – "Create room" asks the server for a new room; the server picks the 8-character code. Share the link to invite friends.
- **Ducks** – pick one of 12 colors. Tap the grass to waddle there. Ducks bob when idle, waddle when moving, quack when they talk, dance when music plays, and doze off after a quiet minute.
- **Scenes** – a room is set in quiet Duck Valley or in the Boat Festival: a riverside with racing boats, flags, lanterns, food stalls, drums and a cheering crowd. At night the lanterns reflect on the river and small fireworks go off. The room owner switches the scene in Settings (⚙) and everyone sees it change.
- **Wardrobe** – 25 hats and head pieces, from a Broken Egg to a Boat Captain Hat. Pick one on the home screen, or tap your duck in the corner HUD to open the Wardrobe inside a room. Locked items show a padlock and say how to unlock them.
- **Stickers** – six stickers next to the message bar (on a phone, behind the ☺ button). If two different ducks send the same sticker within 3 seconds, they react together: a heart between them, a high five, a duo dance, a laugh, sparkles or flames.
- **Items** – a duck can hold a beer, a sword, a flower or a gun. Pick one on the home screen, or change it in Settings (⚙) inside a room.
- **Chat** – type in the bar at the bottom. Messages show in the chat journal (on desktop, drag its title bar to move it; on a phone it opens as a drawer) and as a bubble above the duck for 5 seconds.
- **Music** – the radio is shared: station and play/pause are the same for everyone. The room owner (👑) always controls it, can upload songs, and decides who else may: nobody, chosen DJs (🎧), or everyone. Members can ask to be a DJ. Volume and mute are per user. Sound starts only after you press "Join the room audio".
- **Theme and settings** – ☀ / ☾ switches day and night. ⚙ opens Settings (volume, theme, reduced motion).

## Design

Duck Room looks like a small pixel-art adventure game: the Duck Valley scene fills the screen and the
controls sit on top of it as cream RPG panels and wooden buttons.

- **All art is code.** Sprites are written as text grids, one character per pixel, and turned into crisp SVG images by `lib/pixel.ts`. There are no image files.
- **Ducks** (`lib/duckSprites.ts`) are 16×16 sprites with a hand-picked palette per color and sprite-sheet animations: idle with blink, walk, quack, dance and sleep.
- **Scenery** (`lib/sceneSprites.ts`, `components/RoomScene.tsx`) has two scenes that share one valley, Duck Valley and the Boat Festival. It is layered: sky and clouds, mountains, forest, cottage, pond, grass, then small details. Every sprite has its own night palette, so night is a repaint and not a dark filter.
- **UI kit** (`components/pixel/ui.tsx`): `PixelPanel`, `PixelButton`, `PixelIconButton`, `PixelInput`, `PixelBadge`, `PixelDialog`, `PixelSpeechBubble`. Room pieces are in `components/room/` (`UserHUD`, `ChatPanel`, `MusicRadio`).
- **Fonts**: Pixelify Sans for titles, buttons and labels; Nunito for chat and long text; Noto Sans Lao for Lao text. All are served from this site.
- **Motion** uses stepped sprite frames. It follows the system "reduce motion" setting, and Settings has its own switch.
- Buttons and other touch targets are at least 44×44 pixels.

## Wearables

Ducks are drawn in layers: shadow, body, face slot, head slot, then what is in the wing. A wearable
is not a new duck sprite; it is a small sprite placed on an anchor point of the body, so it bobs,
waddles, flips and scales together with the duck.

- **Catalog** – `shared/cosmetics.ts` lists every wearable: id, slot, rarity, event, and its offset from the anchor. The art for each id is in `lib/wearableSprites.ts`.
- **Slots** – `head`, `face`, `neck`, `back`. `head` has most of the items and `neck` has the Spring Scarf; `face` and `back` are ready for later.
- **Rules** – `server/cosmetics.ts` decides what a session may equip:

| Rarity | Who can equip it |
| --- | --- |
| Common | Everyone |
| Rare | Sessions that have hosted (created) a room |
| Special (Gold Crown) | The current leader of the room |
| Event | Everyone, while the event is on: the item belongs to the active seasonal event, or that event's config lists it under `ducks.accessories`. Boat Festival items also unlock while the room owner has set the scene to the festival |

- An item you are already wearing stays on when it becomes locked again (the event ends, or you stop leading). You cannot put it back on once you take it off.
- Clients send only a wearable id. The server checks that it exists, is enabled, fits the slot and is unlocked, then broadcasts the outfit. Other users receive what a duck wears, never what its owner has unlocked.
- Outfits and unlocks belong to the anonymous session, so they survive a reconnect. They are kept in server memory behind `CosmeticRepository`, so they are lost on restart; a database can replace it later.

## Seasonal events

One generic engine runs every festival. An event is a record of configuration: dates, a priority,
and the names of a scene, decorations, particles, weather, a radio station and duck accessories.
No room code mentions any particular event.

- **Server decides.** `server/events.ts` checks the calendar every 15 seconds. An event is active when it is enabled and the server's clock is inside its dates; if several overlap, the highest `priority` wins. Browsers are told the result and never use their own clock to decide.
- **Config** – the built-in calendar is `config/events.ts`: Boat Racing Festival, Halloween, Full Moon, Loy Krathong, Christmas, New Year, Valentine, Sakura Festival, Pi Mai Lao and Rainy Season. The types and validation are in `shared/events.ts`.
- **Registries** – `features/events/event-registry.tsx` maps each name in a config to something on screen: scenes (a layout plus a palette), decorations, particles and weather. A name with no entry is skipped and logged; it never breaks the room. An unknown scene falls back to Duck Valley, and an unknown station to the normal ones.
- **What an active event changes** – the world's look for every room, a banner with a countdown, an extra radio station, and which event hats can be equipped. Chat, movement, music control and ownership work exactly as before.
- **Room owner's scene** – when no event is running, the owner can still switch the room between Valley and Festival in Settings. An active event overrides that.

### Example: the Sakura Festival

The Sakura Festival was added after the engine, and shows what a new festival takes:

- **Config** – one entry in `config/events.ts`: the `sakura-duck-valley` scene, six decorations, three particle effects, the `sakura-lofi` station and five accessories.
- **Art** – cherry trees, a branch, a lantern, petals, a picnic blanket, a basket, a tea set, a bench and a tea stand in `lib/sceneSprites.ts`; a `sakura` palette for day and night in `app/globals.css`.
- **Registry** – entries for the scene, the decorations and the `sakuraPetals` particle in `event-registry.tsx`.
- **Petals** – `SakuraPetalParticles` draws 30 petals on a desktop, 20 on a tablet and 12 on a phone. Each has its own speed, drift and size and turns through four frames. A gust blows a few across every 30 to 90 seconds. They run locally with CSS only; nothing is sent to the server. With reduced motion they are not shown; the petals lying on the grass remain.
- **Stickers** – 🌸 🌺 🍵 🌙 are seasonal: `shared/stickers.ts` marks them with the event, and the server refuses them at any other time. Two 🌸 make a small cherry tree bloom between the ducks.
- **Wardrobe** – four new items. The Spring Scarf is the first item for the `neck` slot.

No change was needed in chat, movement, presence, music control or ownership.

### Adding a festival

1. Draw any new sprites in `lib/sceneSprites.ts` and register new decorations in `event-registry.tsx` (skip this if existing ones are enough).
2. Add an entry to `config/events.ts`, or create it on `/admin/events`.
3. Preview it, then enable it.

### Preview

Add `?event=<slug>` to any page, for example `/?event=halloween`. The server allows this only in
development or for a signed-in admin. It changes only what that one browser draws: nobody else
sees it and no hats unlock.

### Admin

`/admin/events` lists the events with their status and warnings, and edits everything in a config
with a live preview of the scene. It needs an admin account (see below); signing in gives a signed,
HttpOnly cookie for 8 hours, sign-in attempts are limited to 5 a minute per address, and changes
are saved to `DATA_DIR/events.json` so they survive a restart. Built-in events added by a later update appear automatically; ones you deleted stay deleted.

#### Admin accounts

Admin names and passwords are **not** in `.env`. They are in a small SQLite database file,
`DATA_DIR/duck-room.db` (SQLite is built into Node 22.5 and later, so nothing extra is installed).

- Only a salted scrypt hash of each password is stored. The password cannot be read back from the file.
- Accounts are made on the server, never over the network:

  ```bash
  npm run admin set sam      # create "sam", or change sam's password (asks for it, hidden)
  npm run admin list
  npm run admin remove sam
  ```

- A password needs 12 or more characters. The running server sees a new account or password at once.
- With no account, the admin page and its API are switched off.
- The file is readable only by the user who runs the server, and `data/` is ignored by git.
  Back it up with the rest of `data/`, and keep it on a disk that survives a redeploy.
- A wrong name and a wrong password get the same answer and take the same time. Neither is logged.

### Not built yet

The config has fields for quests, rewards, a leaderboard, a minigame, special duck colors and an
ambient sound. They are stored and shown on the admin page, but nothing reads them yet.

### Event messages

| Event | Sent when |
| --- | --- |
| `event:state` | On every change, and inside `room:snapshot` when you join: `{ state: { eventId, slug, version, startAt, endAt }, event }`. Ignore a `version` older than the one you have |
| `event:started`, `event:updated`, `event:ended` | The same payload, when an event begins, its config changes, or it ends |

Room members cannot send any of these.

## Matching stickers

When two ducks happen to send the same sticker, the server pairs them and starts one shared
animation. Nobody picks a partner; the coincidence is the trigger.

- **The server decides.** `sticker:send` carries only a sticker id. The server takes the sender from the session, keeps each duck's latest sticker for 3 seconds, and looks for another duck's matching one. Payloads with `userId`, `targetUserId` or `interactionType` are rejected.
- **Rules** – same room, different ducks, same sticker, within the time window. A duck cannot match itself. The first pair wins; a third duck's sticker stays available for someone else. A duck in an interaction cannot start another, and the same pair waits 5 seconds before matching again.
- **Meeting** – ducks closer than 0.2 of the room walk to a midpoint and face each other (the server moves them, so everyone agrees where they are). Ducks farther apart are not moved: each reacts where it stands, joined by a trail of the sticker.
- **Timing** – the match event carries a start time 150 ms in the future on the server's clock, so every screen starts together. An event that arrives after its animation would have ended is ignored.
- **Movement** – while the animation plays (2 to 3 seconds), moves from those two ducks are ignored, then control returns.
- **Limits** – 1 sticker a second and 10 a minute per duck.
- **Reduced motion** – the effects are replaced by a still "duck, sticker, duck" badge that fades in and out.
- **Adding one** – add the sticker to `shared/stickers.ts`, its effect to `features/stickers/interaction-registry.tsx`, and its body moves to `features/stickers/duck-moves.ts`.

## Shared music control (DJ mode)

Each room has a setting for who may control the radio. New rooms start as owner only.

| Mode | Who can play, pause, skip and change station |
| --- | --- |
| `OWNER_ONLY` | The owner |
| `DJ_ONLY` | The owner and the DJs the owner has named |
| `EVERYONE` | Any member in the room |

- **One rule, checked by the server.** `canControlMusic` in `shared/protocol.ts` is the only test; `requireMusicControl` in `server/auth.ts` applies it to every music command. Commands carry no user, role or owner flag: the server works out who is asking from the session.
- **Only the owner changes permissions.** A DJ cannot name other DJs or change the mode. Uploading and removing songs, and the room's scene, also stay with the owner.
- **DJs** are remembered by user id, so a DJ who reconnects is still a DJ. If the owner leaves and the room passes to someone else, the new owner gets full control and the DJs stay.
- **Request DJ** – a member without control can ask. Only the owner is told, and accepting names them a DJ (and switches an owner-only room to DJ mode).
- **Who did it** – `music:state` carries `changedByUserId`, shown as "Started by Bow 🎧".
- **Pace** – play and pause: 5 per 10 seconds; station and next: 3 per 10 seconds each. When members other than the owner share the radio, accepted changes must also be 1.5 seconds apart, so a crowd cannot skip through stations.
- **Version** – every accepted command raises `version`; clients keep the newest state.

## Voice chat

Press **Join voice** above the radio, allow the microphone, and talk. The sound goes directly
from browser to browser (WebRTC), so there is no server in between to add delay, and the server
never hears or stores anything.

- **Microphone** switches your own microphone. It stays open while off, so switching it back on is instant.
- **Speaker** stops playing the others, for you only.
- A duck in the voice chat shows a small microphone on its name tag. The tag's border turns green
  while that duck speaks. Each browser works this out from the sound it receives, so it lights up at once.
- The radio plays quieter while someone else is speaking.

The server's part is small (`voice:*` in [docs/socket-events.md](docs/socket-events.md)): it keeps
the list of who is in the voice chat and passes connection details between two ducks who are both
in it. Code: `shared/voice.ts`, `features/voice/`, and the `voice:` handlers in `server/realtime.ts`.

Limits to know:

- At most `MAX_VOICE_USERS` (8) per room. Every talker is connected to every other one, which stops
  working well beyond a handful of people. A larger voice chat needs a media server (an SFU such as LiveKit).
- The microphone only works on `https` or on `localhost`. `npm run share` gives you `https`.
- Without a TURN server (see the environment variables) people on mobile data or strict office
  networks may join and hear nothing.
- There is no moderation yet: the owner cannot mute or remove someone from the voice chat.

## Loy Krathong: carry and float

During the Loy Krathong event a duck can take a krathong at the stall, carry it, and set it
afloat at the river's edge. Everyone in the room sees it drift downstream.

- **Zones** – `shared/interactions.ts` defines interaction zones as rectangles in room coordinates: one pickup zone at the stall and two release zones along the river. The zone system is generic (`krathong-pickup`, `krathong-release`, and reserved kinds for later events). A button appears when your duck stands in a zone where something can be done.
- **Carrying** – what a duck carries is the server's record (`carriedItem` on the user). The krathong is its own layer on the duck sprite, so it moves and flips with the duck, and the duck walks normally.
- **Releasing** – the duck is busy for 1.8 seconds (no walking, stickers or pickups), the krathong touches the water after 0.8 seconds with a ripple, and then drifts.
- **Drifting costs no messages.** The server sends one `krathong:spawned` with a start point, direction, speed and times. Every browser works out the position from that, as one CSS animation per krathong. A late joiner gets the list in `room:snapshot` and sees each krathong where everyone else does.
- **Server decides everything**: who is acting (from the session), whether the event is on, whether the zone exists and is used by this event, whether the duck is really standing there (by the server's own record of its position), where the krathong starts, how it drifts and when it expires. Payloads carry only a zone id and a design.
- **Limits** – from the event's config (`interactions.krathong`): one krathong per duck every 15 seconds, at most 40 on the river (the oldest makes room for a new one; nobody is refused), each floats for 40 seconds. Pickups: 6 per 10 seconds.
- **Leaving** – a krathong keeps floating after its owner disconnects. A duck that disconnects while carrying gets its krathong back if the same session returns within 30 seconds. When the event ends, carried krathongs are put down and the river is cleared.
- **Reduced motion** – the krathong still drifts slowly, since that is the feature; its bobbing, candle flicker and ripple are stopped.
- **Designs** – five recolors of one drawing (`lib/krathongSprites.ts`): pink lotus, white lotus, banana leaf, golden flower, purple flower. The stall hands out a random one.

## Architecture

```text
Browser
   │
   ├── HTTPS ── Next.js pages            (app/, components/, lib/)
   │            /api/session, /api/rooms, /upload    (server/http.ts)
   │
   └── WSS ──── Socket.IO                (server/realtime.ts)
                  │
                  ├── Sessions           (server/sessions.ts)
                  ├── Authorization      (server/auth.ts)
                  ├── Rate limits        (server/rateLimit.ts)
                  ├── Rooms + chat       (server/rooms.ts)
                  └── Music + uploads    (config/music.ts, server/uploads.ts)
```

| Path | What it holds |
| --- | --- |
| `shared/protocol.ts` | The contract used by both sides: Zod schemas, event types, error codes, allowed duck colors |
| `server/` | The server: entry point, HTTP endpoints, Socket.IO pipeline, sessions, rooms, logging |
| `config/music.ts` | Built-in stations (URLs come from environment variables) |
| `app/`, `components/`, `lib/` | The pages, the duck and pond, and browser helpers |
| `features/events/` | The event engine on the browser side: provider, registries, renderer and banner |
| `features/stickers/` | Sticker bar, interaction effects and their renderer |
| `tests/` | Security, wearables, event and sticker tests |

Rooms are kept in memory behind the `RoomRepository` interface in `server/rooms.ts`, so Redis or a
database can replace `MemoryRoomRepository` later. Because rooms live in memory, run exactly one
server process; a restart clears all rooms.

### Every socket event follows the same steps

```text
session → payload validation → room membership → authorization → rate limit → logic → broadcast
```

This lives in one place (`on()` in `server/realtime.ts`). The server is the source of truth for
identity, membership, owner, duck positions, messages and music. The browser only owns local
preferences: theme, volume, mute, and where the chat window is.

## Security

- **Identity** – the server creates `userId` and `sessionId` with `crypto.randomUUID()` and stores them in a signed cookie (`HttpOnly`, `SameSite=Strict`, `Secure` in production). The browser chooses only a display name and a duck color. A changed cookie fails its signature check.
- **Ownership** – the server stores `ownerUserId` per room. Payloads are strict: extra fields such as `userId`, `isOwner` or `role` make the whole payload invalid.
- **Authorization** – `requireRoomMember` and `requireRoomOwner` in `server/auth.ts` are used by every handler.
- **Room codes** – 8 characters from 32 symbols (40 bits), made with `crypto.randomInt` and checked for collisions. There is no endpoint that lists rooms, unknown and closed rooms give the same answer, and join attempts are rate limited.
- **Validation** – every event has a Zod schema. Duck colors are an allowlist. Display names are 1–24 characters with no control characters. Chat is plain text, up to 300 characters; control characters and text-direction overrides are removed, emoji are kept.
- **XSS** – chat is rendered as text by React; nothing uses `dangerouslySetInnerHTML`. A Content-Security-Policy is sent as a second layer.
- **Music** – only predefined stations and files the owner uploads. Nobody can submit an audio URL. Uploads are checked for owner, type, size (20 MB), and that the file really starts like audio.
- **Transport** – socket messages over 4 KB close the connection. Only `APP_ORIGIN` may open a WebSocket or call the POST endpoints, and no CORS access is granted. POST endpoints also need a custom header that other sites cannot send.
- **Headers** – `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy: no-referrer` (the room code is in the URL), `Permissions-Policy`, and HSTS when `APP_ORIGIN` is https in production.
- **Errors** – clients get `{ code, message }` with a generic message. Stack traces and internal details stay in the server log.
- **Logging** – one JSON line per event (`ROOM_CREATED`, `ROOM_JOIN`, `ROOM_LEAVE`, `OWNER_CHANGED`, `CHAT_RATE_LIMITED`, `INVALID_SOCKET_EVENT`, `MUSIC_PERMISSION_DENIED`, `SESSION_INVALID`, `ROOM_DELETED`, …) with `timestamp`, `event`, `roomId`, `userId`, `result`. Cookies, secrets and room codes are never logged.

Known limits:

- The Content-Security-Policy allows inline scripts and styles (`'unsafe-inline'`), because Next.js needs them without a per-request nonce.
- Uploaded song URLs are unguessable but not access-checked: anyone who has the link can download the file.
- Rate limits are per process and reset on restart.

### Rate limits

| Action | Limit |
| --- | --- |
| New connections | 30 / minute / IP |
| `room:join` | 10 / minute / user, 30 / minute / IP |
| `duck:move` | 20 / second / user (extra moves are dropped quietly) |
| `chat:message` | 5 / 5 seconds and 20 / minute / user; 3 hits in a minute mute the user for 30 seconds |
| `music:play`, `music:pause` | 5 / 10 seconds / user |
| `music:station`, `music:next` | 3 / 10 seconds / user each |
| Owner settings (scene, permissions, removing songs) | 20 / 10 seconds / user |
| `music:requestDJ` | 1 / 30 seconds / user |
| Create room | 5 / minute / user, 20 / hour / IP |
| Upload song | 5 / minute / user |
| `sticker:send` | 1 / second and 10 / minute / user |
| `room:create` (socket) | 5 / minute / user, 20 / hour / IP (shared with Create room) |
| `room:resync` | 5 / 10 seconds / user |
| `krathong:pickup` | 4 / minute / user |
| `krathong:release` | 4 / minute / user, and 1 / 15 seconds (set by the event) |
| Any events on one connection | 100 / second, then the connection is closed |

## Environment variables

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` turns on the strict checks below |
| `PORT` | `3000` | Port for pages and Socket.IO |
| `APP_ORIGIN` | – | **Required in production.** The only origin allowed to use the server, e.g. `https://duckroom.example.com` |
| `SESSION_SECRET` | random per start in dev | **Required in production** (32+ characters). Signs the session cookie |
| `TRUST_PROXY` | `false` | `true` behind Cloudflare or nginx, so rate limits see the visitor's real IP |
| `FORCE_EVENT` | empty | Makes one event active whatever its dates say, e.g. `christmas`. For testing or showing friends |
| `DATA_DIR` | `data` | Folder for saved events (`events.json`) and admin accounts (`duck-room.db`) |
| `DEFAULT_SCENE` | `valley` | The scene new rooms start in and the home page shows: `valley` or `festival` |
| `MAX_ROOM_USERS` | `50` | Ducks per room |
| `MAX_VOICE_USERS` | `8` | Ducks in one room's voice chat. Every talker sends sound directly to every other one, so keep it small |
| `STUN_URLS` | a public Google STUN server | Comma-separated. Helps two browsers find a direct path for voice |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_PASSWORD` | empty | A TURN server that relays voice when there is no direct path (mobile data, office networks). Without one, some people join and hear nothing. These credentials are sent to browsers, so use an account made only for this |
| `MAX_ROOMS` | `1000` | Rooms on the server at once |
| `MAX_MESSAGE_LENGTH` | `300` | Chat length (cannot go above 300) |
| `EMPTY_ROOM_TTL_SECONDS` | `300` | How long an empty room is kept |
| `OWNER_GRACE_SECONDS` | `30` | How long an absent owner keeps the room |
| `PRESENCE_GRACE_SECONDS` | `30` | How long a duck stays in the room after its connection drops, so a reload or short network loss does not remove it |
| `LOFI_STREAM_URL`, `JAZZ_STREAM_URL`, `RAIN_STREAM_URL`, `PIANO_STREAM_URL` | empty | Optional trusted `https` stream per station. Empty means the browser generates the music |

## HTTP endpoints

| Endpoint | Needs | Result |
| --- | --- | --- |
| `GET /api/session` | – | Creates the session cookie if missing. Returns `{ ok, userId, scene, event, inventory, equipment }`: the default scene, the active event, and what this session may wear and last wore |
| `POST /api/rooms` | session, own origin, `x-duck-room: 1` header | `{ ok, code }`. The caller becomes the owner |
| `POST /upload?room=CODE&name=…` | same, and room owner. Body is the audio file | `201`; the server adds the song and broadcasts `music:state` |
| `GET /uploads/<file>` | – | The uploaded audio |
| `GET /api/events/preview?slug=…` | development, or admin | One event's config, for previewing |
| `POST /api/admin/login` | body `{ token }`, own origin, `x-duck-room: 1` | Sets the admin cookie |
| `GET` / `PUT` / `DELETE /api/admin/events` | admin cookie (changes also need own origin and the header) | List, save or delete events |

## Socket events

There is one contract. It lives in `shared/socket/` (event maps, acknowledgements, error codes)
and `shared/protocol.ts` (the Zod schemas and state types). The browser and the server both import
it, so they cannot disagree. Two documents describe it:

- [docs/socket-events.md](docs/socket-events.md): every event, its payload, who may send it, its rate limit and its errors.
- [docs/sync-contract.md](docs/sync-contract.md): how browsers stay in step (snapshot, versions, resync, reconnect, repeated commands).

The short version:

- A payload says what the user wants. It never says who the user is: there is no `userId`, role or
  `isOwner` in a self-action, and every schema is strict, so such a field makes the payload invalid.
- Every command is answered with `{ ok: true, commandId?, data? }` or
  `{ ok: false, commandId?, error: { code, message, retryAfterMs? } }`. A command sent without an
  acknowledgement gets its error as `socket:error`.
- Commands that change shared things carry a `commandId` (a UUID). The same id is carried out once;
  a repeat gets the first answer again.
- `room:snapshot` replaces everything a browser holds. Every later update carries `roomVersion`:
  the next number is applied, an old one ignored, and a jump answered with `room:resync`.

Error codes: `INVALID_PAYLOAD`, `UNAUTHENTICATED`, `FORBIDDEN`, `ROOM_NOT_FOUND`, `ROOM_FULL`,
`NOT_IN_ROOM`, `INVALID_STATE`, `TOO_FAR`, `RATE_LIMITED`, `EVENT_INACTIVE`, `OBJECT_NOT_FOUND`,
`CONFLICT`, `VERSION_MISMATCH`, `INTERNAL_ERROR`.

### Owner leaving

If the owner disconnects, they have `OWNER_GRACE_SECONDS` to come back with the same session and
keep the room. After that the server gives the room to the member who has been connected longest
and sends `room:ownerChanged`. Clients cannot nominate themselves. When the last duck leaves, the
room is deleted after `EMPTY_ROOM_TTL_SECONDS`, together with its messages, music state and songs.

## Share your local copy with friends

To let friends test the copy running on your computer, without deploying anything:

```bash
npm run share
```

This builds the app, opens a Cloudflare quick tunnel (needs `cloudflared`, no Cloudflare account)
and prints a public `https://….trycloudflare.com` link. Open that link yourself instead of
localhost, create a room, and send your friends the room link. Press Ctrl+C to stop; the link
stops working at once, and the next run gets a new address.

While it runs, anyone who has the link can reach the app on your computer, and your computer
must stay on and awake.

## Deploy

Run exactly one Node process, on a VPS or a container host such as Railway, Render or Fly.io.
It does not run on serverless hosts.

```bash
npm ci && npm run build
npm start
```

Set `NODE_ENV=production`, `APP_ORIGIN` and `SESSION_SECRET`; the server refuses to start without
them. Serve it over HTTPS.

### Cloudflare in front

Set `TRUST_PROXY=true` so rate limits use the visitor's real address.

**Option 1 – Cloudflare Tunnel (simplest on a VPS, no open ports, no nginx):**

```bash
cloudflared tunnel login
cloudflared tunnel create duck-room
cloudflared tunnel route dns duck-room duck.example.com
cloudflared tunnel run --url http://localhost:3000 duck-room
```

**Option 2 – DNS proxy (Railway, Render, or a VPS with nginx):**

1. Add your domain to Cloudflare and create a DNS record pointing at the host, with the proxy (orange cloud) on.
2. SSL/TLS → set encryption mode to **Full (strict)**.
3. Network → make sure **WebSockets** is on.
4. If you use nginx on a VPS, it needs the WebSocket upgrade headers and `client_max_body_size 20m;` for song uploads.
