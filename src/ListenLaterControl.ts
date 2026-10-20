import type { RoonLibraryClient, TrackInfo } from 'roon-library-controls';
import { Arg, buildArgs } from 'roon-library-controls/dist/src/args.js';
import { field, type RoonObject, type ObjectGraph } from 'roon-library-controls/dist/src/graph.js';
import { BinaryReader } from 'roon-library-controls/dist/src/wire.js';
import type { RemotingClient } from 'roon-library-controls/dist/src/remoting.js';

type Internal={graph:ObjectGraph;trackObject(zone:string):RoonObject|undefined;profileSooid():Buffer|undefined;serviceOid(name:string):bigint|undefined;remoting:RemotingClient};
const SIGNATURE='Sooloos.Broker.Api.Library::SetListenLaterState(System.Sooid, Sooloos.Broker.Api.TrackBase, Sooloos.Broker.Api.ListenLaterState, Base.ResultCallback)';

/** Read the exact profile's flag; malformed or unsupported data stays unknown. */
export function readListenLater(client:RoonLibraryClient,track:TrackInfo){
 const unavailable={listenLater:null,canListenLater:false};
 try{
  const internal=client as unknown as Internal,profile=internal.profileSooid(),target=internal.trackObject(track.zoneId);
  if(!profile||!target||String(field(target,'TrackId'))!==track.trackId)return unavailable;
  const library=internal.graph.findByType('Library')[0];
  if(field(library,'SupportsListenLater')!==true)return unavailable;
  const raw=field(target,'IsListenLater');
  if(!Buffer.isBuffer(raw)||raw.length===0)return unavailable;
  const reader=new BinaryReader(raw),count=reader.flexInt();
  if(count<0||count>1024)return unavailable;
  let saved=false;
  for(let i=0;i<count;i++){
   const who=reader.sooid(),value=reader.flexInt();
   if(value!==0&&value!==1)return unavailable;
   if(who.equals(profile))saved=value===1;
  }
  if(reader.remaining!==0)return unavailable;
  return {listenLater:saved,canListenLater:true};
 }catch{return unavailable;}
}

/** This changes Listen Later only; it never adds a track to the library. */
export async function changeListenLater(client:RoonLibraryClient,track:TrackInfo,saved:boolean,recheck:()=>Promise<void>){
 const internal=client as unknown as Internal,before=readListenLater(client,track);
 if(!before.canListenLater)throw Error('Listen Later is unavailable for this recording.');
 const target=internal.trackObject(track.zoneId)!,profile=internal.profileSooid()!;
 await recheck();
 const latest=internal.trackObject(track.zoneId),currentProfile=internal.profileSooid(),library=internal.serviceOid('Library');
 if(!latest||latest.oid!==target.oid||String(field(latest,'TrackId'))!==track.trackId||!currentProfile?.equals(profile))throw Error('Listen Later target changed. Nothing was changed.');
 if(library===undefined)throw Error('Listen Later service is unavailable.');
 const result=await internal.remoting.callMethod(library,SIGNATURE,buildArgs([Arg.sooid(profile),Arg.ref(target.oid),Arg.enum(saved?1:0)]));
 if(!result.success)throw Error('Roon did not accept the Listen Later change.');
}
