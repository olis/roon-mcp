import type { BrowseItem } from "node-roon-api-browse";
import { BrowseSessionManager } from "./BrowseSessionManager.js";
import { encodeLocator, type RadioLocator } from "./locator.js";
import { RoonMcpError, type MusicCandidate, type SearchMusicOutput } from "./types.js";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Shared-hierarchy My Live Radio navigation, under the caller's profile lock. */
export async function savedStations(browse: BrowseSessionManager): Promise<BrowseItem[]> {
  const opened = await browse.browse({ hierarchy: "internet_radio", pop_all: true });
  if (opened.action !== "list") {
    throw new RoonMcpError("BROWSE_FAILED", opened.message ?? "My Live Radio is unavailable.");
  }
  const items: BrowseItem[] = [];
  let offset = 0;
  while (true) {
    const page = await browse.load({ hierarchy: "internet_radio", offset, count: 100 });
    if (page.offset !== offset) throw new RoonMcpError("BROWSE_FAILED", "Unexpected radio page offset.");
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.list.count) break;
    if (!page.items.length) throw new RoonMcpError("BROWSE_FAILED", "Incomplete saved station list.");
  }
  // The Core exposes saved stations as direct actions, not action menus.
  return items.filter(item => Boolean(item.item_key) && item.hint === "action");
}

export async function resolveStation(browse: BrowseSessionManager, loc: RadioLocator): Promise<BrowseItem> {
  const matches = (await savedStations(browse)).filter(item =>
    item.title === loc.ra && (item.subtitle ?? "") === loc.subtitle);
  if (matches.length !== 1) throw new RoonMcpError("INVALID_ITEM_KEY",
    "Saved station is missing or ambiguous; refresh list_radio_stations or search_music.");
  return matches[0]!;
}

export class RadioService {
  constructor(private readonly browse: BrowseSessionManager) {}

  async listStations(): Promise<{ stations: MusicCandidate[]; total: number; message?: string }> {
    return this.browse.runExclusiveWithRetry(async () => {
      const stations = (await savedStations(this.browse)).map(item => this.candidate(item, 1));
      return { stations, total: stations.length,
        ...(stations.length ? {} : { message: "No saved stations in My Live Radio." }) };
    });
  }

  async search(query: string, limit: number): Promise<SearchMusicOutput> {
    return this.browse.runExclusiveWithRetry(async () => {
      const q = normalize(query);
      const candidates = (await savedStations(this.browse)).flatMap(item => {
        const title = normalize(item.title);
        if (!q || !title.includes(q)) return [];
        return [this.candidate(item, title === q ? 1 : title.endsWith(q) ? 0.9 : 0.7)];
      }).sort((a, b) => b.score - a.score).slice(0, limit);
      return { query, candidates, broadened: false,
        ...(candidates.length ? {} : { message: `No saved radio station matches "${query}".` }) };
    });
  }

  private candidate(item: BrowseItem, score: number): MusicCandidate {
    return { itemKey: encodeLocator({ ra: item.title, subtitle: item.subtitle ?? "" }),
      title: item.title, subtitle: item.subtitle, type: "radio", score, available: true,
      sourceGroup: "My Live Radio" };
  }
}
