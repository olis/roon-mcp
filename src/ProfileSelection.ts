import type { BrowseItem, BrowseResultBody } from "node-roon-api-browse";

import { BrowseSessionManager } from "./BrowseSessionManager.js";
import { RoonMcpError } from "./types.js";

// Initial local fix for ROON-001. Make configurable after Core validation.
const TARGET_PROFILE = "Oliver";

/** Run inside the browse lock, before any search or queue-building operation. */
export async function ensureOliverProfile(browse: BrowseSessionManager): Promise<void> {
  const fail = (message: string): never => {
    throw new RoonMcpError("PROFILE_SELECTION_FAILED", message);
  };

  const checkResponse = (body: BrowseResultBody): void => {
    if (body.action === "message" && body.is_error) {
      fail(body.message ?? "Roon rejected profile selection.");
    }
  };

  const loadItems = async (): Promise<BrowseItem[]> => {
    const items: BrowseItem[] = [];
    let offset = 0;
    while (true) {
      const page = await browse.load({ hierarchy: "settings", offset, count: 100 });
      items.push(...page.items);
      offset += page.items.length;
      if (offset >= page.list.count) return items;
      if (page.items.length === 0) fail("Roon returned an incomplete settings list.");
    }
  };

  const openProfiles = async (): Promise<BrowseItem[]> => {
    const root = await browse.browse({
      hierarchy: "settings", pop_all: true,
    });
    checkResponse(root);
    if (root.action !== "list") fail("Roon did not expose the settings hierarchy.");

    const settings = await loadItems();
    const entries = settings.filter((item) => /^(profile|profil)$/i.test(item.title.trim()));
    const entry = entries[0];
    if (entries.length !== 1 || !entry?.item_key) {
      fail("Could not identify the Profile entry in Roon settings.");
    }
    const opened = await browse.browse({
      hierarchy: "settings", item_key: entry!.item_key!,
    });
    checkResponse(opened);
    if (opened.action !== "list") fail("Roon did not expose the profile list.");
    return loadItems();
  };

  const findOliver = (items: BrowseItem[]): BrowseItem => {
    const matches = items.filter((item) => item.title.trim() === TARGET_PROFILE);
    const item = matches[0];
    if (matches.length !== 1 || !item?.item_key) {
      return fail('Roon profile "Oliver" is missing or ambiguous.');
    }
    return item;
  };
  const isSelected = (item: BrowseItem): boolean =>
    /^(selected|ausgewählt)$/i.test(item.subtitle?.trim() ?? "");

  const target = findOliver(await openProfiles());
  if (isSelected(target)) return;

  checkResponse(await browse.browse({ hierarchy: "settings", item_key: target.item_key! }));
  if (!isSelected(findOliver(await openProfiles()))) {
    fail('Roon did not confirm profile "Oliver" as selected.');
  }
  process.stderr.write('[roon] Profile "Oliver" selected and verified.\n');
}
