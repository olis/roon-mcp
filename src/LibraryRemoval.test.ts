import test from 'node:test';
import assert from 'node:assert/strict';
import {ObjectGraph,PropertyType} from 'roon-library-controls/dist/src/graph.js';
import {Arg,buildArgs,inlineStruct} from 'roon-library-controls/dist/src/args.js';
import {decodeCollection,selectRemoval,prepareRemoval} from './LibraryRemoval.js';
import type {TrackInfo,RoonLibraryClient} from 'roon-library-controls';
const TYPE='Sooloos.Broker.Api.DeletePreview';
function fixture(action=3){
 const graph=new ObjectGraph();graph.types.set(1,{id:1,name:TYPE,members:[{name:TYPE+'::Action',propType:PropertyType.Enum},{name:TYPE+'::Track',propType:PropertyType.Object},{name:TYPE+'::Album',propType:PropertyType.Object}]});
 graph.objects.set(10n,{oid:10n,typeId:2,typeName:'TrackLite',fields:{'TrackLite::LibraryTrackId':100n,'TrackLite::Title':'Song','TrackLite::Album':{$ref:20n}}});
 graph.objects.set(20n,{oid:20n,typeId:3,typeName:'AlbumLite',fields:{'AlbumLite::Title':'Album'}});
 const payload=buildArgs([Arg.collection([inlineStruct(1,[buildArgs([Arg.enum(action)]),buildArgs([Arg.ref(10)]),buildArgs([Arg.ref(0)])])])]);
 const track={zoneId:'room',trackId:'stream-id',libraryTrackId:'100',title:'Song',album:{title:'Album'},inLibrary:true} as TrackInfo;
 return {graph,payload,track};
}
test('decodes preview and permits only an exact single provider track',()=>{
 const f=fixture();const preview=decodeCollection(f.graph,f.payload,TYPE);assert.deepEqual(selectRemoval(f.graph,preview,f.track),{action:3,trackObject:10n});
 for(const action of [0,1,2,6,99]){const g=fixture(action);assert.throws(()=>selectRemoval(g.graph,decodeCollection(g.graph,g.payload,TYPE),g.track));}
 for(const expected of [{...f.track,libraryTrackId:'101'},{...f.track,title:'Other'},{...f.track,album:{...f.track.album!,title:'Other'}}])assert.throws(()=>selectRemoval(f.graph,preview,expected));
 assert.throws(()=>selectRemoval(f.graph,[...preview,...preview],f.track));
});
test('malformed preview lengths and unexpected types are rejected',()=>{
 const f=fixture();assert.throws(()=>decodeCollection(f.graph,Buffer.concat([f.payload,Buffer.from([0])]),TYPE));assert.throws(()=>decodeCollection(f.graph,f.payload,'Other'));
});
test('unsafe previews never produce a delete operation',async()=>{
 for(const action of [0,3]){
  const f=fixture(action),calls:string[]=[];
  const client={graph:f.graph,serviceOid:()=>1n,remoting:{callMethod:async(_id:bigint,sig:string)=>{calls.push(sig);return {success:true,payload:f.payload};},struct:()=>Buffer.from('single-track-struct')}} as unknown as RoonLibraryClient;
  if(action===0)await assert.rejects(prepareRemoval(client,f.track));else assert.equal(typeof await prepareRemoval(client,f.track),'function');
  assert.equal(calls.length,1);assert.match(calls[0]!,/PreviewDelete/);
 }
});
