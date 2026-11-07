import type { RoonLibraryClient } from 'roon-library-controls';
import { field, type ObjectGraph, type RoonObject } from 'roon-library-controls/dist/src/graph.js';
import { Arg, buildArgs } from 'roon-library-controls/dist/src/args.js';
import type { RemotingClient } from 'roon-library-controls/dist/src/remoting.js';
import type { PlaybackResult } from './types.js';

const GET = 'Sooloos.Broker.Api.Queue::GetItems(Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.TransportItem>>)';
const REMOVE = 'Sooloos.Broker.Api.Queue::RemoveItems(System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.TransportItem>)';
type Internal = {graph:ObjectGraph; remoting:RemotingClient; zoneObject(id:string):RoonObject|undefined};

/** Remove only the old future entries, after the first new track has queued successfully. */
export async function replaceUpcoming(client:RoonLibraryClient, zoneId:string, insertNext:()=>Promise<PlaybackResult>) {
  const internal = client as unknown as Internal;
  const zone = internal.zoneObject(zoneId);
  const queue = internal.graph.deref(field(zone, 'Queue'));
  const current = () => internal.graph.deref(field(internal.zoneObject(zoneId), 'NowPlaying'));
  if (!queue || !current()) throw Error('The current queue is unavailable. Playback was not changed.');
  const read = async () => {
    const result = await internal.remoting.callMethod(queue.oid, GET, Buffer.alloc(0));
    if (!result.success) throw Error('Roon could not read the queue.');
    const items = internal.graph.decodeReturnList(result.payload).map(ref => internal.graph.deref(ref));
    if (items.some(item => !item || item.typeName !== 'Sooloos.Broker.Api.TransportItem')) throw Error('Unsupported queue response.');
    return items as RoonObject[];
  };
  const items = await read();
  const anchor = current();
  const index = items.findIndex(item => item.oid === anchor?.oid);
  if (index < 0 || field(queue, 'CurrentItemIndex') !== index) throw Error('The current queue changed. Try the station again.');
  const old = items.slice(index + 1);
  // No await between the final current-item check and starting the insertion.
  if (current()?.oid !== anchor?.oid) throw Error('The current song changed. Try the station again.');
  const result = await insertNext();
  if (!result.ok || !result.queued) throw Error('The new opening track could not be queued. The old queue was kept.');
  // A natural track boundary may have occurred during Browse navigation. Never
  // remove the song that is now playing, even if it belonged to the old mix.
  const latest = await read();
  const now = current();
  const currentIndex = latest.findIndex(item => item.oid === now?.oid);
  if (currentIndex < 0 || field(queue, 'CurrentItemIndex') !== currentIndex) throw Error('Playback changed during station handover. Check the queue.');
  const future = new Set(latest.slice(currentIndex + 1).map(item => item.oid));
  const removed = old.filter(item => future.has(item.oid));
  if (removed.length) {
    internal.remoting.callMethodNoReply(queue.oid, REMOVE,
      buildArgs([Arg.collection(removed.map(item => buildArgs([Arg.ref(item.oid)])))]));
    // This mutation has no callback. Confirm with read-back; never retry it.
    const remaining = await read();
    const ids = new Set(removed.map(item => item.oid));
    if (remaining.some(item => ids.has(item.oid))) throw Error('Roon did not confirm removal of the old upcoming mix. Check the queue before retrying.');
  }
  return {...result, removed:removed.length, message:'New mix queued after the current song; old upcoming mix removed.'};
}
