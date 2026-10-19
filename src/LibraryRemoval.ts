import type { RoonLibraryClient, TrackInfo } from 'roon-library-controls';
import { Arg, buildArgs } from 'roon-library-controls/dist/src/args.js';
import { ObjectGraph, PropertyType } from 'roon-library-controls/dist/src/graph.js';
import { BinaryReader } from 'roon-library-controls/dist/src/wire.js';
import type { RemotingClient } from 'roon-library-controls/dist/src/remoting.js';

const PREVIEW='Sooloos.Broker.Api.Library::PreviewDelete(System.Collections.Generic.IEnumerable<long>, Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.DeletePreview>>)';
const REMOVE='Sooloos.Broker.Api.Library::Delete(System.Collections.Generic.IList<Sooloos.Broker.Api.DeletePreview>, Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.DeleteResult>>)';
const TYPE='Sooloos.Broker.Api.DeletePreview';
type Internal={graph:ObjectGraph;remoting:RemotingClient;serviceOid(name:string):bigint|undefined};
function field(object:unknown,name:string):unknown { if(!object||typeof object!=='object')return undefined;const fields='fields' in object?(object as {fields:Record<string,unknown>}).fields:object;return Object.entries(fields).find(([key])=>key.endsWith('::'+name))?.[1]; }
export function decodeCollection(graph:ObjectGraph,payload:Buffer,type:string):unknown[]{
 const reader=new BinaryReader(payload),length=reader.flexInt();if(length!==reader.remaining)throw Error('Unexpected removal response length.');
 const count=reader.flexInt();if(count<1||count>32)throw Error('Unexpected removal response count.');
 const values=[];for(let i=0;i<count;i++){const value=graph.readValue(reader,PropertyType.Object) as {$type?:string};if(value?.$type!==type)throw Error('Unexpected removal response type.');values.push(value);}
 if(reader.remaining)throw Error('Unexpected trailing removal data.');return values;
}
export function selectRemoval(graph:ObjectGraph,previews:unknown[],track:TrackInfo){
 const matches=previews.filter(preview=>{const item=graph.deref(field(preview,'Track'));return String(field(item,'LibraryTrackId'))===track.libraryTrackId;});
 if(matches.length!==1)throw Error('Roon did not preview exactly the selected track.');
 const preview=matches[0],item=graph.deref(field(preview,'Track')),album=graph.deref(field(item,'Album'));
 if(field(item,'Title')!==track.title||field(album,'Title')!==(track.album?.title??''))throw Error('Removal preview does not match this recording.');
 const action=field(preview,'Action');
 // DeleteFile (0) and all unknown operations are rejected. Only provider removals.
 if(![3,4,5].includes(action as number))throw Error('This removal would delete a local audio file. Use Roon to manage local files.');
 return {action:action as number,trackObject:item!.oid};
}
export async function prepareRemoval(client:RoonLibraryClient,track:TrackInfo){
 if(!track.inLibrary||!track.libraryTrackId||!/^\d+$/.test(track.libraryTrackId))throw Error('No saved track is available to remove.');
 const internal=client as unknown as Internal,library=internal.serviceOid('Library');if(library===undefined)throw Error('Library service unavailable.');
 const result=await internal.remoting.callMethod(library,PREVIEW,buildArgs([Arg.collection([buildArgs([Arg.long(BigInt(track.libraryTrackId))])])]));
 if(!result.success)throw Error('Roon could not preview removal.');
 const selected=selectRemoval(internal.graph,decodeCollection(internal.graph,result.payload,TYPE),track);
 const value=internal.remoting.struct(TYPE,[
  {name:'Sooloos.Broker.Api.DeleteAction '+TYPE+'::Action',propType:PropertyType.Enum,value:buildArgs([Arg.enum(selected.action)])},
  {name:'Sooloos.Broker.Api.TrackLite '+TYPE+'::Track',propType:PropertyType.Object,value:buildArgs([Arg.ref(selected.trackObject)])},
  {name:'Sooloos.Broker.Api.AlbumLite '+TYPE+'::Album',propType:PropertyType.Object,value:buildArgs([Arg.ref(0)])},
 ]);
 return async()=>{
  const removed=await internal.remoting.callMethod(library,REMOVE,buildArgs([Arg.collection([value])]));
  if(!removed.success)throw Error('Roon rejected the library removal.');
  const results=decodeCollection(internal.graph,removed.payload,'Sooloos.Broker.Api.DeleteResult');
  if(results.length!==1)throw Error('Roon returned an unexpected removal result.');
  // Zero is Deleted; sparse fields omit their default zero value.
  if((field(results[0],'Status')??0)!==0)throw Error('Roon did not confirm removing this track.');
 };
}
