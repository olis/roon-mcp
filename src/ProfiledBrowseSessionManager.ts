import type { BrowseHierarchy, BrowseOptions, BrowseResultBody, LoadOptions } from "node-roon-api-browse";
import { BrowseSessionManager } from "./BrowseSessionManager.js";
import { RoonMcpError } from "./types.js";

/**
 * Keep profile selection, content navigation and queue actions in the same
 * Core-side hierarchy. Dedicated settings/search/genres hierarchies retain
 * independent profile contexts on the Core.
 *
 * Services retain their logical roots; only wire requests use `browse`.
 */
export class ProfiledBrowseSessionManager extends BrowseSessionManager {
  override async browse(options: BrowseOptions): Promise<BrowseResultBody> {
    if (!options.pop_all || options.hierarchy === "browse") {
      return super.browse({ ...options, hierarchy: "browse" });
    }

    const paths: Partial<Record<BrowseHierarchy, string[]>> = {
      settings: ["Settings"],
      search: ["Library", "Search"],
      genres: ["Genres"],
      internet_radio: ["My Live Radio"],
    };
    const path = paths[options.hierarchy];
    if (!path) {
      throw new RoonMcpError("BROWSE_FAILED", `Unsupported logical browse root: ${options.hierarchy}`);
    }

    let result = await super.browse({ hierarchy: "browse", pop_all: true });
    for (let i = 0; i < path.length; i++) {
      if (result.action !== "list") {
        throw new RoonMcpError("BROWSE_FAILED", `Could not open ${path[i]} in the shared browse hierarchy.`);
      }
      const items = [];
      let offset = 0;
      while (true) {
        const page = await super.load({ hierarchy: "browse", offset, count: 100 });
        items.push(...page.items);
        offset += page.items.length;
        if (offset >= page.list.count) break;
        if (!page.items.length) throw new RoonMcpError("BROWSE_FAILED", "Incomplete browse navigation list.");
      }
      const matches = items.filter(item => item.title.trim().toLowerCase() === path[i]!.toLowerCase());
      if (matches.length !== 1 || !matches[0]?.item_key) {
        throw new RoonMcpError("BROWSE_FAILED", `Missing or ambiguous ${path[i]} entry in shared browse hierarchy.`);
      }
      const { pop_all: _pop, hierarchy: _hierarchy, ...rest } = options;
      result = await super.browse({
        hierarchy: "browse",
        ...(i === path.length - 1 ? rest : {}),
        item_key: matches[0].item_key,
      });
    }
    return result;
  }

  override load(options: LoadOptions) {
    return super.load({ ...options, hierarchy: "browse" });
  }
}
