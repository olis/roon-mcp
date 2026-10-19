import { RoonLibraryClient, type TrackInfo } from "roon-library-controls";
import { RoonClient } from "./RoonClient.js";
import { TransportService } from "./TransportService.js";

/** Optional internal-protocol adapter, confined to the already paired Core. */
export class LibraryControlService {
  private client?: RoonLibraryClient;
  private identity = "";
  private connectedAt = 0;
  private retryAfter = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly roon: RoonClient, private readonly transport: TransportService) {}
  close() { const client = this.client; this.client = undefined; client?.close(); }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run); this.tail = result.catch(() => {}); return result;
  }
  private async connection() {
    if (process.env.ROON_LIBRARY_CONTROLS === "0") throw new Error("Library controls are disabled.");
    const core = await this.roon.waitForCore();
    const host = (core as unknown as { moo?: { transport?: { host?: string } } }).moo?.transport?.host;
    if (!host) throw new Error("Paired Core address unavailable.");
    const identity = core.core_id + ":" + host;
    if (identity !== this.identity) { this.close(); this.retryAfter = 0; this.identity = identity; }
    if (Date.now() < this.retryAfter) throw new Error("Library connection unavailable. Retrying later.");
    if (this.client?.connected && (this.client.objectCount > 20000 || Date.now() - this.connectedAt > 86400000)) this.close();
    if (!this.client?.connected) {
      this.close();
      const client = new RoonLibraryClient({ host, coreId: core.core_id, requestTimeoutMs:8000, confirmTimeoutMs:8000 });
      this.client = client;
      client.on("disconnected", () => { if (this.client === client) this.retryAfter = Date.now() + 300000; });
      try { await client.connect(); this.connectedAt = Date.now(); }
      catch (error) { this.close(); this.retryAfter = Date.now() + 300000; throw error; }
    }
    return this.client!;
  }
  private checkProfile(client: RoonLibraryClient) {
    // The pinned adapter uses the first Profile object. Fail closed unless it is Oliver.
    const profile = (client as unknown as { profileObject(): { fields: Record<string, unknown> } | undefined }).profileObject();
    const name = Object.entries(profile?.fields ?? {}).find(([key]) => key.endsWith("::Name"))?.[1];
    if (name !== "Oliver") throw new Error('Library controls require Roon profile "Oliver".');
  }
  private async current(client: RoonLibraryClient, zoneId: string) {
    this.checkProfile(client);
    const official = await this.transport.getNowPlaying(zoneId);
    const track = client.trackForZone(zoneId);
    if (!track?.trackId || !same(track.title, official.title) || !same(track.album?.title, official.album)) throw new Error("Track changed or library status is unavailable. Refresh and try again.");
    return track;
  }
  status(zoneId: string) {
    return this.exclusive(async () => { const client = await this.connection(); return status(await this.current(client, zoneId)); });
  }
  add(zoneId: string, expected: { trackId: string; title: string; album: string }) {
    return this.exclusive(async () => {
      const client = await this.connection();
      const track = await this.current(client, zoneId);
      validateExpected(track, expected);
      if (track.inLibrary) return status(track);
      if (track.source !== "streaming") throw new Error("This track cannot be added to the library.");
      // No await between checking the current object and the adapter capturing that object.
      const latest = client.trackForZone(zoneId); if (!latest) throw new Error("Nothing playing.");
      validateExpected(latest, expected);
      const added = await client.addToLibrary(zoneId, "track");
      if (!added.inLibrary || !same(added.title, expected.title) || !same(added.album?.title, expected.album)) throw new Error("Song changed while adding. Refresh to check its status.");
      return status(added);
    });
  }
}
function same(a?: string, b?: string) { return (a ?? "").normalize("NFKC") === (b ?? "").normalize("NFKC"); }
export function validateExpected(track: TrackInfo, expected: { trackId: string; title: string; album: string }) {
  if (track.trackId !== expected.trackId || !same(track.title, expected.title) || !same(track.album?.title, expected.album)) throw new Error("The current song changed. Nothing was added.");
}
function status(track: TrackInfo) { return { zoneId: track.zoneId, trackId: track.trackId, title: track.title, album: track.album?.title ?? "", inLibrary: track.inLibrary, canAdd: !track.inLibrary && track.source === "streaming" }; }
