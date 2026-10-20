import test from 'node:test';
import {BinaryWriter} from 'roon-library-controls/dist/src/wire.js';
import assert from 'node:assert/strict';
import {LibraryControlService} from './LibraryControlService.js';
import type {RoonClient} from './RoonClient.js';
import type {TransportService} from './TransportService.js';
import type {TrackInfo} from 'roon-library-controls';
function fixture(){
 let track: TrackInfo={zoneId:'room',trackId:'1',libraryTrackId:null,title:'Song',album:{title:'Album',roonAlbumId:'album',inLibrary:false,favorite:false},source:'streaming',inLibrary:false,favorite:false,banned:false};
 let adds=0,favorites=0,profile='Oliver';
 const client={profileObject:()=>({fields:{'string Profile::Name':profile}}),trackForZone:()=>track,addToLibrary:async()=>{adds++;track={...track,inLibrary:true,libraryTrackId:'1'};return track;}};
 Object.assign(client,{
   awaitLibraryTrack:async()=>({oid:10n,fields:{'TrackLite::TrackId':BigInt(track.libraryTrackId??'0')}}),
   profileSooid:()=>Buffer.alloc(18),serviceOid:()=>1n,
   remoting:{callMethod:async(_id:bigint,signature:string)=>{if(!signature.includes('FavoriteOrBan'))throw Error('Preview unavailable in fixture');favorites++;track={...track,favorite:!track.favorite};return {success:true};}}
 });
 const service=new LibraryControlService({} as RoonClient,{getNowPlaying:async()=>({zoneId:'room',title:'Song',album:'Album'})} as unknown as TransportService);
 (service as unknown as {connection:()=>Promise<unknown>}).connection=async()=>client;
 return {service,client,expected:{trackId:'1',title:'Song',album:'Album'},adds:()=>adds,favorites:()=>favorites,set:(value:Partial<TrackInfo>)=>{track={...track,...value};},profile:(value:string)=>{profile=value;}};
}
test('reads membership separately from favourites, then confirms a single-track add',async()=>{
 const f=fixture();assert.equal((await f.service.status('room')).inLibrary,false);const added=await f.service.add('room',f.expected);assert.equal(added.inLibrary,true);assert.equal(f.adds(),1);await f.service.add('room',f.expected);assert.equal(f.adds(),1);
});
test('rejects changed track ids, recordings, source or profile before a mutation',async()=>{
 for(const change of [ {trackId:'2'}, {title:'Other song'}, {album:{title:'Other album',roonAlbumId:'other',inLibrary:false,favorite:false}}, {source:'local'} ] as Partial<TrackInfo>[]){const f=fixture();f.set(change);await assert.rejects(f.service.add('room',f.expected));assert.equal(f.adds(),0);}
 const f=fixture();f.profile('Kamila');await assert.rejects(f.service.add('room',f.expected));assert.equal(f.adds(),0);
});
test('requires the Core to confirm the expected song was added',async()=>{
 const f=fixture();f.client.addToLibrary=async()=>({...await f.client.trackForZone(),inLibrary:false});await assert.rejects(f.service.add('room',f.expected));
});

test('a stale internal graph gets one bounded read-only resync',async()=>{
 const f=fixture();f.set({title:'Old song'});let connections=0;
 (f.service as unknown as {connection:()=>Promise<unknown>}).connection=async()=>{connections++;if(connections===2)f.set({title:'Song'});return f.client;};
 const result=await f.service.status('room');assert.equal(result.title,'Song');assert.equal(connections,2);assert.equal(f.adds(),0);
 f.set({title:'Old again'});await assert.rejects(f.service.status('room'));assert.equal(connections,3);
});

test('liking saves only the selected track; unliking keeps it in the library',async()=>{
 const f=fixture();const liked=await f.service.favorite('room',f.expected,true);assert.equal(liked.favorite,true);assert.equal(liked.inLibrary,true);assert.equal(f.adds(),1);
 const unliked=await f.service.favorite('room',f.expected,false);assert.equal(unliked.favorite,false);assert.equal(unliked.inLibrary,true);assert.equal(f.adds(),1);assert.equal(f.favorites(),2);
});
test('changed recordings or another profile cannot be liked',async()=>{
 for(const mode of ['track','profile']){const f=fixture();if(mode==='track')f.set({trackId:'other'});else f.profile('Kamila');await assert.rejects(f.service.favorite('room',f.expected,true));assert.equal(f.adds(),0);assert.equal(f.favorites(),0);}
});


test('Listen Later confirms native state without saving streaming tracks to the library',async()=>{
 const f=fixture();let saved=false,calls=0;
 Object.assign(f.client,{
  graph:{findByType:()=>[{fields:{'Library::SupportsListenLater':true}}]},
  trackObject:()=>({oid:10n,fields:{'TrackLite::TrackId':1n,'TrackLite::IsListenLater':saved?new BinaryWriter().flexInt(1).sooid(Buffer.alloc(18)).flexInt(1).toBuffer():Buffer.from([0])}}),
  remoting:{callMethod:async(_id:bigint,signature:string)=>{assert.match(signature,/SetListenLaterState/);calls++;saved=!saved;return{success:true};}}
 });
 assert.equal((await f.service.listenLater('room',f.expected,true)).listenLater,true);
 assert.equal(f.adds(),0);assert.equal(calls,1);
 await f.service.listenLater('room',f.expected,true);assert.equal(calls,1);
 assert.equal((await f.service.listenLater('room',f.expected,false)).listenLater,false);
 assert.equal(f.adds(),0);assert.equal(calls,2);
});

test('Listen Later rejects another profile, changed tracks, and unconfirmed writes',async()=>{
 for(const mode of ['profile','track','confirmation']){
  const f=fixture();let calls=0;
  Object.assign(f.client,{
   graph:{findByType:()=>[{fields:{'Library::SupportsListenLater':true}}]},
   trackObject:()=>({oid:10n,fields:{'TrackLite::TrackId':1n,'TrackLite::IsListenLater':Buffer.from([0])}}),
   remoting:{callMethod:async()=>{calls++;return{success:true};}}
  });
  if(mode==='profile')f.profile('Kamila');if(mode==='track')f.set({trackId:'changed'});
  await assert.rejects(f.service.listenLater('room',f.expected,true));
  assert.equal(calls,mode==='confirmation'?1:0);assert.equal(f.adds(),0);
 }
});
