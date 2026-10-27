import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowseItem, BrowseOptions, LoadOptions } from "node-roon-api-browse";
import { BrowseSessionManager } from "./BrowseSessionManager.js";
import { RadioService } from "./RadioService.js";
import { SearchService } from "./SearchService.js";
import { GenreService } from "./GenreService.js";
import { TrackExpansionService } from "./TrackExpansionService.js";
import { PlaybackService } from "./PlaybackService.js";
import { RoonClient } from "./RoonClient.js";
import { ZoneService } from "./ZoneService.js";
import { encodeLocator, decodeLocator, hierarchyForLocator } from "./locator.js";

const station = (title: string, subtitle = "Germany") : BrowseItem => ({ title, subtitle, hint: "action", item_key: title });
function fixture(initial: BrowseItem[], options: { error?: boolean; truncated?: boolean; unavailable?: boolean; denied?: boolean; response?: string; playing?: string } = {}) {
  let items = initial;
  let generation = 0;
  let guards = 0;
  const calls: BrowseOptions[] = [];
  const offsets: number[] = [];
  const api = {
    browse(o: BrowseOptions, cb: (error: false, body: unknown) => void) {
      calls.push(o);
      assert.equal(o.hierarchy, "internet_radio");
      if (o.pop_all) { generation++; cb(false, { action: options.unavailable ? "message" : "list", message: "Unavailable" }); return; }
      assert.ok(o.zone_or_output_id, "station action always needs a target zone");
      assert.ok(o.item_key?.startsWith(`${generation}:`), "must re-resolve a fresh key");
      cb(false, options.error ? { action: "message", is_error: true, message: "Stream failed" } : { action: options.response ?? "none" });
    },
    load(o: LoadOptions, cb: (error: false, body: unknown) => void) {
      const offset = o.offset ?? 0; offsets.push(offset);
      cb(false, { items: options.truncated && offset ? [] : items.slice(offset, offset + (o.count ?? 100)).map((i, n) => ({ ...i, item_key: `${generation}:${offset + n}` })),
        offset, list: { title: "My Live Radio", count: items.length } });
    },
  };
  const roon = { waitForCore: async () => undefined, getBrowse: () => api, getActiveSubscription: () => undefined } as unknown as RoonClient;
  const browse = new BrowseSessionManager(roon, undefined, async () => { guards++; if(options.denied)throw Error("Profile denied"); });
  const tracks = new TrackExpansionService(browse);
  const zones = { resolveTarget: async () => ({ targetId: "room" }), nowPlayingFor: async () => options.playing ?? "hr1" } as unknown as ZoneService;
  return { radio: new RadioService(browse), search: new SearchService(browse, new GenreService(browse), tracks),
    playback: new PlaybackService(browse, zones, roon, tracks), tracks, calls, offsets,
    guards: () => guards, replace: (next: BrowseItem[]) => { items = next; } };
}

test("lists every saved station across pages without invoking station actions", async () => {
  const f = fixture(Array.from({length: 205}, (_, i) => station(`FM ${i}`)));
  const result = await f.radio.listStations();
  assert.equal(result.total, 205); assert.equal(result.stations.length, 205);
  assert.deepEqual(f.offsets, [0, 100, 200]); assert.equal(f.guards(), 1);
  assert.ok(f.calls.every(c => c.pop_all && !c.zone_or_output_id));
  assert.equal(hierarchyForLocator(decodeLocator(result.stations[204]!.itemKey)!), "internet_radio");
});

test("typed radio search matches hr 1, returns ambiguities and never falls back to music", async () => {
  const f = fixture([station("Hessischer Rundfunk: hr1"), station("BBC Radio 2"), station("Radio Paradise: Main Mix"), station("Radio Paradise: Rock Mix")]);
  const found = await f.search.searchMusic({query: "hr 1", type: "radio"});
  assert.equal(found.candidates.length, 1); assert.equal(found.candidates[0]!.type, "radio");
  assert.equal((await f.radio.search("radio paradise", 50)).candidates.length, 2);
  const missing = await f.search.searchMusic({query: "Unknown Station", type: "radio"});
  assert.deepEqual(missing.candidates, []); assert.equal(missing.broadened, false);
  assert.match(missing.message!, /No saved radio station/);
  assert.ok(f.calls.every(c => c.pop_all));
});

test("empty, unavailable and incomplete catalogues are explicit", async () => {
  assert.match((await fixture([]).radio.listStations()).message!, /No saved stations/);
  await assert.rejects(fixture([], {unavailable:true}).radio.listStations(), /Unavailable/);
  await assert.rejects(fixture(Array.from({length:101},()=>station("FM")), {truncated:true}).radio.listStations(), /Incomplete/);
});

test("radio reads and playback are blocked when profile verification fails", async () => {
  const f = fixture([station("hr1")], {denied:true});
  await assert.rejects(f.radio.listStations(), /Profile denied/);
  await assert.rejects(f.playback.playNow({itemKey:encodeLocator({ra:"hr1",subtitle:"Germany"}),zoneId:"room"}), /Profile denied/);
  assert.equal(f.calls.length, 0);
});

test("playback re-resolves identity after reordering then invokes exactly one targeted station action", async () => {
  const f = fixture([station("hr1"), station("BBC Radio 2")]);
  const key = (await f.radio.search("hr1", 10)).candidates[0]!.itemKey;
  f.replace([station("BBC Radio 2"), station("hr1")]);
  const result = await f.playback.playNow({itemKey:key, zoneId:"room"});
  assert.equal(result.ok, true); assert.equal(result.queued, 0);
  assert.deepEqual(f.calls.filter(c=>c.item_key), [{hierarchy:"internet_radio",item_key:"2:1",zone_or_output_id:"room"}]);
  assert.equal(f.guards(), 2);
});

test("missing or indistinguishable stations cannot start another station", async () => {
  for (const items of [[], [station("hr1"),station("hr1")]]) {
    const f = fixture(items);
    await assert.rejects(f.playback.playNow({itemKey:encodeLocator({ra:"hr1",subtitle:"Germany"}),zoneId:"room"}), /missing or ambiguous/);
    assert.ok(f.calls.every(c=>c.pop_all));
  }
});

test("station errors are surfaced without retrying playback", async () => {
  const f = fixture([station("hr1")], {error:true});
  await assert.rejects(f.playback.playNow({itemKey:encodeLocator({ra:"hr1",subtitle:"Germany"}),zoneId:"room"}), /Stream failed/);
  assert.equal(f.calls.filter(c=>c.item_key).length,1);
});

test("stations reject shuffle, append and track expansion without any station action", async () => {
  const f = fixture([station("hr1")]); const key=encodeLocator({ra:"hr1",subtitle:"Germany"});
  await assert.rejects(f.playback.playNow({itemKey:key,shuffle:true}), /immediate playback only/);
  await assert.rejects(f.playback.playNow({itemKey:key,addToQueue:true}), /immediate playback only/);
  assert.equal((await f.tracks.getTracksFor({itemKey:key})).tracks.length, 0);
  const queue = await f.playback.enqueueAndPlay({itemKeys:[key],zoneId:"room"});
  assert.equal(queue.queued,0); assert.equal(f.calls.length,0);
});


test("successful radio action can reset Browse to Explore", async () => {
  const f=fixture([station("hr1")],{response:"list"});
  const result=await f.playback.playNow({itemKey:encodeLocator({ra:"hr1",subtitle:"Germany"}),zoneId:"room"});
  assert.equal(result.ok,true); assert.equal(result.nowPlaying,"hr1");
  assert.equal(f.calls.filter(c=>c.item_key).length,1);
});

test("unconfirmed radio start reports uncertainty and is never retried", async () => {
  const f=fixture([station("hr1")],{response:"list",playing:"Old Track"});
  const result=await f.playback.playNow({itemKey:encodeLocator({ra:"hr1",subtitle:"Germany"}),zoneId:"room"});
  assert.equal(result.ok,false); assert.match(result.message!,/not yet confirmed/);
  assert.equal(f.calls.filter(c=>c.item_key).length,1);
});
