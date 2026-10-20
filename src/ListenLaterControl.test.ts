import test from 'node:test';
import assert from 'node:assert/strict';
import type {RoonLibraryClient,TrackInfo} from 'roon-library-controls';
import {BinaryWriter} from 'roon-library-controls/dist/src/wire.js';
import {Arg,buildArgs} from 'roon-library-controls/dist/src/args.js';
import {readListenLater,changeListenLater} from './ListenLaterControl.js';

function fixture(){
 const profile=Buffer.alloc(18,1),other=Buffer.alloc(18,2),calls:{signature:string;args:Buffer}[]=[];
 const track={zoneId:'room',trackId:'123',title:'Song',source:'streaming',inLibrary:false} as TrackInfo;
 const target={oid:10n,fields:{'TrackLite::TrackId':123n,'TrackLite::IsListenLater':Buffer.from([0]) as Buffer}};
 const library={fields:{'Library::SupportsListenLater':true}};
 const raw={trackObject:()=>target,profileSooid:()=>profile,serviceOid:()=>1n,graph:{findByType:()=>[library]},remoting:{callMethod:async(_id:bigint,signature:string,args:Buffer)=>{calls.push({signature,args});return{success:true};}}};
 return {profile,other,calls,track,target,library,raw,client:raw as unknown as RoonLibraryClient};
}
test('Listen Later status belongs to Oliver, including unsaved streaming recordings',()=>{
 const f=fixture();
 assert.deepEqual(readListenLater(f.client,f.track),{listenLater:false,canListenLater:true});
 f.target.fields['TrackLite::IsListenLater']=new BinaryWriter().flexInt(1).sooid(f.other).flexInt(1).toBuffer();
 assert.equal(readListenLater(f.client,f.track).listenLater,false);
 f.target.fields['TrackLite::IsListenLater']=new BinaryWriter().flexInt(1).sooid(f.profile).flexInt(1).toBuffer();
 assert.equal(readListenLater(f.client,f.track).listenLater,true);
});
test('missing capability, malformed profile flags and mismatched tracks stay unavailable',()=>{
 for(const raw of [Buffer.alloc(0),Buffer.from([1]),Buffer.from([0,99])]){
  const f=fixture();f.target.fields['TrackLite::IsListenLater']=raw;
  assert.deepEqual(readListenLater(f.client,f.track),{listenLater:null,canListenLater:false});
 }
 const f=fixture();f.library.fields['Library::SupportsListenLater']=false;
 assert.equal(readListenLater(f.client,f.track).canListenLater,false);
 f.library.fields['Library::SupportsListenLater']=true;f.track.trackId='changed';
 assert.equal(readListenLater(f.client,f.track).canListenLater,false);
});
test('changes use the exact current track and Pending or None, without library adds',async()=>{
 for(const saved of [true,false]){
  const f=fixture();let checked=false;
  await changeListenLater(f.client,f.track,saved,async()=>{checked=true;});
  assert(checked);assert.equal(f.calls.length,1);
  assert.match(f.calls[0]!.signature,/SetListenLaterState\(System.Sooid, Sooloos.Broker.Api.TrackBase,/);
  assert.deepEqual(f.calls[0]!.args,buildArgs([Arg.sooid(f.profile),Arg.ref(10n),Arg.enum(saved?1:0)]));
 }
});
test('a changed recording, object or profile cannot receive a stale Listen Later click',async()=>{
 for(const change of ['track','object','profile','official']){
  const f=fixture();
  await assert.rejects(changeListenLater(f.client,f.track,true,async()=>{
   if(change==='official')throw Error('current song changed');
   if(change==='track')f.target.fields['TrackLite::TrackId']=456n;
   if(change==='object')f.raw.trackObject=()=>({...f.target,oid:20n});
   if(change==='profile')f.raw.profileSooid=()=>f.other;
  }));
  assert.equal(f.calls.length,0);
 }
});
