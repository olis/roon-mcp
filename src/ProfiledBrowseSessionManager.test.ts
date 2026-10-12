import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowseOptions, LoadOptions } from "node-roon-api-browse";
import { RoonClient } from "./RoonClient.js";
import { ProfiledBrowseSessionManager } from "./ProfiledBrowseSessionManager.js";
import { ensureOliverProfile } from "./ProfileSelection.js";

function fixture(missingSearch = false) {
  let level = "Explore";
  let profile = "deleted-profile";
  let attributedProfile: string | undefined;
  const calls: BrowseOptions[] = [];
  const lists = () => {
    if (level === "Explore") return ["Settings", "Library", "Genres"];
    if (level === "Settings") return ["Profile"];
    if (level === "Profile") return ["Oliver", "Other"];
    if (level === "Library") return missingSearch ? [] : ["Search"];
    if (level === "Search") return ["Play Now"];
    return [];
  };
  const api = {
    browse(opts: BrowseOptions, cb: (err: false, body: unknown) => void) {
      assert.equal(opts.hierarchy, "browse", "Every wire request must share the profile hierarchy");
      assert.ok([opts.item_key, opts.pop_all, opts.pop_levels, opts.refresh_list].filter(Boolean).length <= 1);
      calls.push(opts);
      if (opts.pop_all) level = "Explore";
      else if (opts.item_key === "Oliver") { profile = "Oliver"; level = "Settings"; }
      else if (opts.item_key === "Play Now") { attributedProfile = profile; }
      else if (opts.item_key) level = opts.item_key;
      cb(false, { action: "list", list: { title: level } });
    },
    load(opts: LoadOptions, cb: (err: false, body: unknown) => void) {
      assert.equal(opts.hierarchy, "browse");
      const items = lists().map(title => ({ title, item_key: title,
        subtitle: level === "Profile" && title === profile ? "selected" : "", hint: "list" }));
      cb(false, { items, list: { title: level, count: items.length }, offset: 0 });
    },
  };
  const roon = { waitForCore: async () => undefined, getBrowse: () => api } as unknown as RoonClient;
  const manager: ProfiledBrowseSessionManager = new ProfiledBrowseSessionManager(roon, undefined, () => ensureOliverProfile(manager));
  return { manager, calls, profile: () => profile, attributedProfile: () => attributedProfile };
}

test("queue actions inherit Oliver from the same hierarchy used for profile selection", async () => {
  const f = fixture();
  await f.manager.runExclusive(async () => {
    await f.manager.browse({ hierarchy: "search", pop_all: true, input: "test song" });
    const list = await f.manager.load({ hierarchy: "search", count: 100 });
    await f.manager.browse({ hierarchy: "search", item_key: list.items[0]!.item_key!, zone_or_output_id: "room" });
  });
  assert.equal(f.attributedProfile(), "Oliver");
  const search = f.calls.find(c => c.item_key === "Search");
  assert.equal(search?.input, "test song");
  assert.equal(f.calls.at(-1)?.zone_or_output_id, "room");
});

test("genre navigation and library export share the verified profile context", async () => {
  const f = fixture();
  await f.manager.runExclusive(async () => {
    await f.manager.browse({ hierarchy: "genres", pop_all: true });
    assert.equal(f.calls.at(-1)?.item_key, "Genres");
  });
  await f.manager.runExclusive(async () => {
    await f.manager.browse({ hierarchy: "browse", pop_all: true });
    const root = await f.manager.load({ hierarchy: "browse" });
    assert.ok(root.items.some(i => i.title === "Library"));
  });
  assert.equal(f.profile(), "Oliver");
});

test("missing shared Search entry fails before any queue action", async () => {
  const f = fixture(true);
  await assert.rejects(f.manager.runExclusive(async () => {
    await f.manager.browse({ hierarchy: "search", pop_all: true, input: "test song" });
    await f.manager.browse({ hierarchy: "search", item_key: "Play Now", zone_or_output_id: "room" });
  }), /Missing or ambiguous Search/);
  assert.equal(f.attributedProfile(), undefined);
});
