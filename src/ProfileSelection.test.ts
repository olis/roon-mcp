import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowseItem, BrowseOptions, LoadOptions } from "node-roon-api-browse";
import { BrowseSessionManager } from "./BrowseSessionManager.js";
import { ensureOliverProfile } from "./ProfileSelection.js";
import { RoonClient } from "./RoonClient.js";
import { RoonMcpError } from "./types.js";

function fixture(options: { selected?: boolean; missing?: boolean; refuse?: boolean; duplicates?: boolean } = {}) {
  let selected = options.selected ?? false;
  let level = "settings";
  let selections = 0;
  let generation = 0;
  const api = {
    browse(opts: BrowseOptions, cb: (err: false, body: unknown) => void) {
      assert.ok([opts.item_key, opts.pop_all, opts.pop_levels, opts.refresh_list].filter(Boolean).length <= 1,
        "Roon allows only one navigation action per Browse request");
      if (opts.pop_all) { level = "settings"; generation++; }
      else if (opts.item_key === `profile:${generation}`) level = "profiles";
      else if (opts.item_key === `oliver:${generation}`) {
        selections++;
        if (!options.refuse) selected = true;
        level = "settings";
      } else throw new Error(`Unexpected or stale key: ${opts.item_key}`);
      cb(false, { action: "list" });
    },
    load(opts: LoadOptions, cb: (err: false, body: unknown) => void) {
      const items: BrowseItem[] = level === "settings"
        ? [{ title: "Profile", item_key: `profile:${generation}` }]
        : options.missing ? [{ title: "Other", item_key: "other" }]
        : [{ title: "Oliver", item_key: `oliver:${generation}`, subtitle: selected ? "selected" : "" }];
      if (options.duplicates && level === "profiles") items.push({ title: "Oliver", item_key: "duplicate" });
      cb(false, { items: items.slice(opts.offset ?? 0), offset: opts.offset ?? 0, list: { count: items.length } });
    },
  };
  let current = api;
  const roon = { waitForCore: async () => undefined, getBrowse: () => current } as unknown as RoonClient;
  const manager: BrowseSessionManager = new BrowseSessionManager(roon, undefined, () => ensureOliverProfile(manager));
  return { manager, selections: () => selections, clear: () => { selected = false; }, reconnect: () => { current = { ...api }; } };
}

test("selects Oliver using a fresh key and verifies before the operation", async () => {
  const f = fixture();
  assert.equal(await f.manager.runExclusive(async () => "ready"), "ready");
  assert.equal(f.selections(), 1);
});

test("already selected Oliver does not execute a selection action", async () => {
  const f = fixture({ selected: true });
  await f.manager.runExclusive(async () => undefined);
  assert.equal(f.selections(), 0);
});

for (const options of [{ missing: true }, { duplicates: true }, { refuse: true }]) {
  test(`blocks the operation when selection cannot be verified: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    let ran = false;
    await assert.rejects(f.manager.runExclusive(async () => { ran = true; }),
      (err) => err instanceof RoonMcpError && err.code === "PROFILE_SELECTION_FAILED");
    assert.equal(ran, false);
  });
}

test("rechecks selection on later operations, including after reconnect", async () => {
  const f = fixture();
  await f.manager.runExclusive(async () => undefined);
  f.clear();
  f.reconnect();
  await f.manager.runExclusive(async () => undefined);
  assert.equal(f.selections(), 2);
});

test("fails if the connection changes within a verified operation", async () => {
  const f = fixture({ selected: true });
  await assert.rejects(f.manager.runExclusive(async () => {
    f.reconnect();
    return f.manager.browse({ hierarchy: "search" });
  }), (err) => err instanceof RoonMcpError && err.code === "PROFILE_CONTEXT_LOST");
  await f.manager.runExclusive(async () => undefined);
});
