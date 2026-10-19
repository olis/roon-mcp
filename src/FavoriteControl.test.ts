import test from 'node:test';
import assert from 'node:assert/strict';
import type {RoonLibraryClient,TrackInfo} from 'roon-library-controls';
import {changeFavorite,resolvedFavorite} from './FavoriteControl.js';
function fixture(){
 const track={zoneId:'room',trackId:'track',libraryTrackId:'100',inLibrary:true,favorite:true} as TrackInfo;
 const calls:string[]=[];
 const client={awaitLibraryTrack:async()=>({oid:10n,fields:{'TrackLite::TrackId':100n}}),trackForZone:()=>track,profileSooid:()=>Buffer.alloc(18),serviceOid:()=>1n,remoting:{callMethod:async(_oid:bigint,sig:string)=>{calls.push(sig);return{success:true};}}};
 return {track,calls,client:client as unknown as RoonLibraryClient};
}
test('favourite changes recheck identity after resolving the library object',async()=>{
 const f=fixture();let checked=false;await changeFavorite(f.client,'room',f.track,false,async()=>{checked=true;});assert(checked);assert.equal(f.calls.length,1);assert.match(f.calls[0]!,/FavoriteOrBan/);
 const stale=fixture();await assert.rejects(changeFavorite(stale.client,'room',stale.track,true,async()=>{throw Error('song changed');}));assert.equal(stale.calls.length,0);
 const wrong=fixture();wrong.track.libraryTrackId='other';await assert.rejects(changeFavorite(wrong.client,'room',wrong.track,true,async()=>{}));assert.equal(wrong.calls.length,0);
});
test('unresolved favourites remain unknown instead of appearing unliked',async()=>{
 const f=fixture();assert.equal(await resolvedFavorite(f.client,f.track),true);
 (f.client as unknown as {awaitLibraryTrack:()=>Promise<never>}).awaitLibraryTrack=async()=>{throw Error('not ready');};assert.equal(await resolvedFavorite(f.client,f.track),null);
 assert.equal(await resolvedFavorite(f.client,{...f.track,inLibrary:false}),false);
});
