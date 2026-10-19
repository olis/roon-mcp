import test from 'node:test';
import assert from 'node:assert/strict';
import {LibraryControlService} from './LibraryControlService.js';
import type {RoonClient} from './RoonClient.js';
import type {TransportService} from './TransportService.js';
import type {TrackInfo} from 'roon-library-controls';
function fixture(){
 let track: TrackInfo={zoneId:'room',trackId:'1',libraryTrackId:null,title:'Song',album:{title:'Album',roonAlbumId:'album',inLibrary:false,favorite:false},source:'streaming',inLibrary:false,favorite:false,banned:false};
 let adds=0,profile='Oliver';
 const client={profileObject:()=>({fields:{'string Profile::Name':profile}}),trackForZone:()=>track,addToLibrary:async()=>{adds++;track={...track,inLibrary:true};return track;}};
 const service=new LibraryControlService({} as RoonClient,{getNowPlaying:async()=>({zoneId:'room',title:'Song',album:'Album'})} as unknown as TransportService);
 (service as unknown as {connection:()=>Promise<unknown>}).connection=async()=>client;
 return {service,client,expected:{trackId:'1',title:'Song',album:'Album'},adds:()=>adds,set:(value:Partial<TrackInfo>)=>{track={...track,...value};},profile:(value:string)=>{profile=value;}};
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
