import type { NowPlayingInfo, PlaybackResult, PlayNowInput } from "./types.js";

/** Switch from an endless stream only after the opening track has been resolved. */
export function handoverMix(
  input: PlayNowInput,
  state: NowPlayingInfo,
  play: (input: PlayNowInput) => Promise<PlaybackResult>,
  replace: (insert: () => Promise<PlaybackResult>) => Promise<PlaybackResult>,
): Promise<PlaybackResult> {
  if (!["playing", "paused", "stopped"].includes(state.state)) {
    throw new Error("Playback is changing. Try the station again.");
  }
  const { replaceUpcoming: _replace, addNext: _next, addToQueue: _append, ...opening } = input;
  if (state.state === "stopped" || state.isLiveStream === true) {
    return play(opening);
  }
  return replace(() => play({ ...opening, addNext: true }));
}
