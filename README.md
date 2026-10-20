# roon-mcp

[![npm version](https://img.shields.io/npm/v/roon-mcp.svg)](https://www.npmjs.com/package/roon-mcp)

An [MCP](https://modelcontextprotocol.io) server to control the **Roon** music
player, so an AI agent can find music and start playback. Built on the official
Roon Extension API (`node-roon-api` + `node-roon-api-transport` /
`node-roon-api-browse`).

---

> **"Play a female vocal trance mix on Roon (Zone: This Computer) — 2000s Dutch trance vibes, the kind of set you'd hear at Amnesia in its prime. Start with something like 4 Strings' Take Me Away."**
>
> *Claude searches across your library and streaming, hand-picks the tracks, and queues them — all from a single natural-language prompt.*

---

## Requirements

- Node.js 20+
- A running **Roon Core** on the local network to pair with
- **git** on the install host — the `node-roon-api*` dependencies are published
  on GitHub (not npm) and are fetched via git URLs during install

## MCP Client Configuration

Add this to your MCP client config. `npx` fetches the package on first run:

```json
{
  "mcpServers": {
    "roon": {
      "command": "npx",
      "args": ["-y", "roon-mcp"],
      "env": { "ROON_DEFAULT_ZONE": "Office" }
    }
  }
}
```

On first launch, open **Roon → Settings → Extensions** and enable **Roon MCP**
to pair. Pairing status is logged to stderr; stdout is reserved for the MCP
protocol. The pairing token is persisted to `~/.config/roon-mcp/config.json`
(override with `ROON_MCP_CONFIG`), so the extension stays authorized across
restarts rather than appearing as a new "Discovered" entry each time.

### Global install (optional)

```bash
npm install -g roon-mcp
```

```json
{
  "mcpServers": {
    "roon": {
      "command": "roon-mcp",
      "env": { "ROON_DEFAULT_ZONE": "Office" }
    }
  }
}
```

## Configuration

| Env var | Purpose |
| --- | --- |
| `ROON_DEFAULT_ZONE` | Optional fallback target for `play_now` / `enqueue_and_play` when no `zoneId` is given — a zone/output id or a display-name substring. If unset, the server falls back to the only zone, an `Office` zone, or the currently-playing zone; if it still can't decide it returns `ZONE_AMBIGUOUS` so the agent can ask. |
| `ROON_HOST` | Optional direct-connection host for the Core's API, bypassing SOOD multicast discovery — for VLAN-segmented networks, VPNs, or containers where discovery doesn't survive. Unset (default) uses discovery as before. |
| `ROON_PORT` | WebSocket port of the Core's API when `ROON_HOST` is set. Defaults to `9330`. |
| `ROON_MCP_CONFIG` | Optional path for the persisted pairing token. A value ending in `.json` is the file itself; anything else is a directory to hold `config.json`. Defaults to `$XDG_CONFIG_HOME/roon-mcp/config.json` (i.e. `~/.config/roon-mcp/config.json`). |

## Tools

| Tool | Purpose |
| --- | --- |
| `list_zones()` | List playable zones/outputs (id, name, state, output ids). |
| `search_music({ query, type?, limit?, includeStreaming? })` | Resolve a text query into ranked browse candidates (opaque, session-scoped item keys). `type` (`artist`/`album`/`track`/`genre`/`playlist`/`radio`) restricts the category; for non-genre types an empty typed search broadens to all categories. See [Streaming search](#streaming-search-genre-and-artist) for `type:"genre"`/`type:"artist"` and `includeStreaming`. |
| `get_tracks_for({ itemKey, limit? })` | Expand an artist/album/genre/playlist candidate into concrete playable tracks. |
| `play_now({ zoneId?, itemKey, shuffle?, addToQueue? })` | Play or queue one search candidate. By default replaces the queue and starts immediately. Pass `addToQueue: true` to append to the existing queue instead. `zoneId` optional (defaults as above). |
| `enqueue_and_play({ zoneId?, itemKeys, shuffle? })` | Build an ad-hoc queue from curated item keys and start it (**replaces** the zone's queue); reports queued/skipped. |
| `now_playing({ zoneId? })` | Snapshot of the zone's current track — state, title, artist, album, seek position. `title`/`artist`/`album` are undefined when nothing is playing. |
| `get_image({ imageKey, size? })` | Fetch cover artwork directly from the paired Core using an `imageKey` from now-playing, queue or browse results. Returns an MCP image content block (JPEG). Size defaults to 600 pixels, bounded to 64–1200; image timeout 10 seconds, payload limit 3 MiB. Read-only. |
| `control_playback({ zoneId?, action })` | Run a transport verb: `pause` / `resume` / `next` / `previous` / `stop` / `playpause` (toggle play/pause). |
| `seek({ zoneId?, seconds, mode? })` | Seek within the current track. `mode:"absolute"` (default) seeks to `seconds` (0 = start); `"relative"` moves by `seconds` (negative skips backward). |
| `set_loop({ zoneId?, mode })` | Set the loop/repeat mode: `off` / `all` / `one`. |
| `set_volume({ zoneId?, level })` | Set the zone's volume to `level` percent (0–100). Rescales to each output's native range; incremental outputs are reported as skipped. |
| `mute({ zoneId?, muted })` | Mute (`muted: true`) or unmute (`muted: false`) every output in the zone. |
| `pause_all()` | Pause every zone on the Core in one call. Resume per zone with `control_playback`. |
| `mute_all({ muted })` | Mute (`muted: true`) or unmute (`muted: false`) every mutable output on the Core. |
| `set_auto_radio({ zoneId?, enabled })` | Turn Roon Radio on/off for a zone: `enabled: true` appends similar tracks once the queue ends, `false` stops playback at queue end. |
| `library_export({ path, limit? })` | Walk Library → Albums and write the album catalog to `path` as JSON (written atomically; parents created; an existing file is only replaced if it is an earlier snapshot). The albums go to the **file** — the result carries only counts and timings. Can take tens of seconds on a large library, and holds the browse session for the whole walk (search/play calls wait behind it). |

### Streaming search (genre and artist)

- **Genre search** fuzzy-matches what you type — "psychedelic trance" will find the right genre even if the name isn't exact. By default results come from your library.
- **`includeStreaming: true`** (on `type:"genre"` or `type:"artist"`) extends the search to your streaming service, so you can play artists or genres that aren't in your local collection.

### Notes

- **After starting playback**, `now_playing` reflects the track that just started, not whatever was playing before.
- **Volume** is set as a percentage (0–100) and works correctly across grouped zones.

### Concurrent instances

Roon pairs only one running instance of an extension at a time. Since every `roon-mcp`
process shares the same identity and persisted pairing token, starting a second instance
(a second MCP client session, or an orphaned process from a closed terminal) no longer
fights the first one for the pairing slot — instead, whichever instance starts first
claims a lock file (`instance.lock`, next to `config.json`) and every other instance
fails fast with a `CORE_PAIRING_HELD` error naming the pid that holds it, instead of
flapping between paired/unpaired.

MCP clients don't always reap server processes when a session ends, so orphaned
`roon-mcp` instances can pile up and hold the lock long after their terminal is gone. If
you hit `CORE_PAIRING_HELD` unexpectedly, clear them out:

```bash
pkill -f roon-mcp
```

The next instance you start will then acquire the lock normally.

## Assumptions

- **Core language: English.** Category/action label matching (`Artists`, `Play Now`,
  `Top Tracks`, …) assumes an English Core.
- **Sources: local library + your configured streaming service.** The server goes
  through Roon's Browse API, which routes to whatever streaming service you have set
  up in Roon (Tidal, Qobuz, etc.). Developed and tested against Tidal — other services
  should work but are untested. Results differ on a local-only Core.
- **Queue: replace.** `enqueue_and_play` starts a fresh queue rather than adding to
  whatever is already playing.
- **Curation is agent-side.** Dedupe / cap-per-artist / ordering / trimming stay in the
  agent; the server has no curation logic.

There is no `save_playlist` tool: Roon exposes no official playlist-write service, so
durable playlists are out of scope. Curated playback is delivered by `enqueue_and_play`
(an ad-hoc, in-the-moment queue).

## Logging

Every Roon API call (`browse`, `load`, `get_zones`, `control`, `change_volume`, `mute`,
`seek`, `change_settings`, `pause_all`, `mute_all`, …) emits one structured line to
**stderr** (stdout stays reserved for MCP JSON-RPC):

```
[roon-call] {"t":"2026-06-19T18:00:00.000Z","lvl":"info","op":"browse","ms":12,"params":{"hierarchy":"search","item_key":"…"},"result":{"action":"list","count":7}}
```

Failures log `lvl:"error"` with the mapped error code, and retries surface as repeated
lines for the same `op`. Grep stderr for `[roon-call]` to trace a flow.

## Development

```bash
npm install              # pulls node-roon-api packages from RoonLabs' GitHub
npm run build
npm test                 # builds, then runs node:test
npm run dev              # tsc --watch
npm run typecheck
```

Run the built server directly:

```bash
npm start
```

### Integration smoke test

`scripts/integration.mjs` spawns the built server over stdio (like a real MCP client)
and runs list → search → expand against your Core. Audible steps are opt-in so it never
blasts music by accident:

```bash
npm run build
node scripts/integration.mjs                 # list_zones + search only (read-only)
ROON_PLAY=1 node scripts/integration.mjs     # also play_now a shuffled genre
ROON_ENQUEUE=1 node scripts/integration.mjs  # also enqueue a few curated tracks
# overrides: ROON_ZONE="Office"  ROON_QUERY="Tycho"
```

Enable **Roon MCP** under Roon → Settings → Extensions on the first run (the script
retries `list_zones` for ~45s while it waits to pair).

## Releasing

```bash
npm run release -- <patch|minor|major>
```

Requires a clean worktree on `main` and a matching `## [<version>]` entry in
[CHANGELOG.md](CHANGELOG.md). The script runs the tests, bumps the version, tags the
commit, and verifies the package with `npm pack`. It then prints the push and
`npm publish` commands to run.

## License

[MIT](LICENSE)


### Optional library controls

`get_library_status({zoneId})` reads the exact current track's library membership. `add_current_to_library({zoneId,trackId,title,album})` adds that single track only after validating the identity returned by the status tool. The add tool never adds whole albums or changes Roon favourites. The adapter verifies its profile is Oliver and waits for Core confirmation before reporting success.

These tools use the unofficial [roon-library-controls](https://github.com/Vulkandr/roon-library-controls) adapter, pinned to commit `590480ced642c75623d5c943262d2f3c951604e9`. They connect lazily to the already paired Core's LAN address on TCP 9332. Roon updates may break this internal protocol. Set `ROON_LIBRARY_CONTROLS=0` to disable it. One shared session is retained, with five-minute backoff after connection failures and session recycling daily or above 20,000 graph objects. Status failures must be shown as unknown, not as an unsaved track.


`remove_current_from_library({zoneId,trackId,title,album})` removes the exact current streaming track after a read-only `PreviewDelete` verifies its library id, title and album. Only provider-removal actions for TIDAL, Qobuz or KKBOX are allowed. Local file deletion and album removal are rejected. The write contains one track preview with no album, is never retried, and is followed by a fresh membership check. Library status includes a bounded, cached read-only removal preview and exposes `canRemove` (or `removeReason`) so unsupported operations remain disabled.


`set_current_favorite({zoneId,trackId,title,album,favorite})` sets Oliver’s current-track favourite flag. `get_library_status` also returns a resolved `favorite` boolean (or null while unavailable) and `canFavorite`. The saved library object is resolved before reading or changing hearts. The exact recording and profile are rechecked after that asynchronous lookup and before sending `FavoriteOrBan`. Liking an unsaved streaming song adds that single track first; unliking leaves membership intact. A fresh read confirms the requested favourite state. These mutations are never automatically retried.


### Native Listen Later

`get_library_status` reports `listenLater` (boolean or null) and `canListenLater` for Oliver's current recording. `set_current_listen_later({zoneId,trackId,title,album,listenLater})` saves or unsaves only that exact song in Roon's native Listen Later, without library additions or playback changes. It rechecks the selected recording and Oliver profile, makes one internal-protocol write, and verifies the state using a fresh connection. Unsupported or unreadable state remains unavailable. This uses the same optional internal adapter as the existing library controls.

### Original release metadata

`get_release_date({zoneId})` reads the exact current track’s album metadata through the optional internal-protocol adapter. It returns `originalAlbumReleaseDate`, `albumReleaseDate`, `isCompilation`, `dateScope: "album"` and `source: "roon-internal"`, with the current track identity. Dates preserve unknown month/day as null. `originalReleaseYear` is null for compilations, various-artist albums or a missing original date; album dates must not be presented as original song dates for compilations. This read-only tool does not change playback or library data and respects `ROON_LIBRARY_CONTROLS=0`.
