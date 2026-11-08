import assert from "node:assert/strict";
import { test } from "node:test";
import { handoverMix } from "./MixHandover.js";
import type { NowPlayingInfo, PlayNowInput, PlaybackResult } from "./types.js";

for (const state of ["playing", "paused", "stopped"] as const) {
  for (const live of [true, false, undefined]) {
    test(`mix handover: ${state}, live stream ${live}`, async () => {
      const calls: PlayNowInput[] = [];
      let replacements = 0;
      const result = { ok: true, queued: 1, zoneId: "room", skipped: [] };
      const play = async (input: PlayNowInput) => { calls.push(input); return result; };
      const replace = async (insert: () => Promise<PlaybackResult>) => { replacements++; return insert(); };
      const snapshot: NowPlayingInfo = {zoneId: "room", displayName: "Room", state, isLiveStream: live};
      assert.equal(await handoverMix({zoneId: "room", itemKey: "opening", replaceUpcoming: true, shuffle: false}, snapshot, play, replace), result);
      const preserve = state !== "stopped" && live !== true;
      assert.equal(replacements, preserve ? 1 : 0);
      assert.deepEqual(calls, [{zoneId: "room", itemKey: "opening", shuffle: false, ...(preserve ? {addNext: true} : {})}]);
    });
  }
}

test("loading or unknown playback never starts or queues a mix", () => {
  for (const state of ["loading", "unknown"] as const) {
    const unexpected = async (): Promise<PlaybackResult> => { throw Error("Unexpected mutation"); };
    assert.throws(() => handoverMix({itemKey: "opening"}, {zoneId: "room", displayName: "Room", state, isLiveStream: true}, unexpected, unexpected), /Playback is changing/);
  }
});

test("a failed live-radio handover is never retried", async () => {
  let attempts = 0;
  await assert.rejects(async () => handoverMix({itemKey: "opening"}, {zoneId: "room", displayName: "Room", state: "playing", isLiveStream: true},
    async () => { attempts++; throw Error("Unconfirmed playback"); },
    async () => { throw Error("Unexpected queue replacement"); }), /Unconfirmed playback/);
  assert.equal(attempts, 1);
});
