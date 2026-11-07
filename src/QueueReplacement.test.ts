import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {RoonLibraryClient} from 'roon-library-controls';
import {ObjectGraph, type RoonObject} from 'roon-library-controls/dist/src/graph.js';
import {BinaryReader} from 'roon-library-controls/dist/src/wire.js';
import {replaceUpcoming} from './QueueReplacement.js';

function fixture() {
 const graph = new ObjectGraph();
 const obj = (oid:bigint, name:string, fields:Record<string,unknown>={}) => {
  const item:RoonObject={oid,typeId:1,typeName:'Sooloos.Broker.Api.'+name,fields};
  graph.objects.set(oid,item);return item;
 };
 const past=obj(10n,'TransportItem'), playing=obj(11n,'TransportItem'), old1=obj(12n,'TransportItem'),old2=obj(13n,'TransportItem'),new1=obj(14n,'TransportItem');
 const queue=obj(2n,'Queue',{'Queue::CurrentItemIndex':1});
 const zone=obj(1n,'Zone',{'Zone::Queue':{$ref:queue.oid},'Zone::NowPlaying':{$ref:playing.oid}});
 let entries=[past,playing,old1,old2],writes=0,confirm=true;
 const removed:bigint[][]=[];
 graph.decodeReturnList=()=>entries.map(item=>({$ref:item.oid}));
 const client={graph,zoneObject:()=>zone,remoting:{
  callMethod:async()=>({success:true,payload:Buffer.alloc(0)}),
  callMethodNoReply:(_oid:bigint,method:string,args:Buffer)=>{
   writes++;assert.match(method,/Queue::RemoveItems/);
   const reader=new BinaryReader(args);assert.equal(reader.flexInt(),reader.remaining);
   const count=reader.flexInt(),ids:bigint[]=[];for(let i=0;i<count;i++)ids.push(reader.flexLong());
   assert.equal(reader.remaining,0);removed.push(ids);
   if(confirm)entries=entries.filter(item=>!ids.includes(item.oid));
  }
 }};
 const insert=async()=>{entries.splice(2,0,new1);return {ok:true,zoneId:'room',queued:1,skipped:[]};};
 return {client:client as unknown as RoonLibraryClient,queue,zone,insert,removed,entries:()=>entries,writes:()=>writes,
  noConfirm:()=>{confirm=false;},advance:()=>{zone.fields['Zone::NowPlaying']={$ref:old1.oid};queue.fields['Queue::CurrentItemIndex']=entries.findIndex(item=>item.oid===old1.oid);}};
}

test('handover retains the current song and played history, removes all old future items',async()=>{
 const f=fixture();const result=await replaceUpcoming(f.client,'room',f.insert);
 assert.equal(result.removed,2);assert.deepEqual(f.removed,[[12n,13n]]);
 assert.deepEqual(f.entries().map(x=>x.oid),[10n,11n,14n]);
 assert.deepEqual(f.zone.fields['Zone::NowPlaying'],{$ref:11n});
});
test('failed insertion and mismatched queue do not remove anything',async()=>{
 const f=fixture();await assert.rejects(replaceUpcoming(f.client,'room',async()=>({ok:false,queued:0,zoneId:'room',skipped:[]})),/old queue was kept/);
 assert.equal(f.writes(),0);
 f.queue.fields['Queue::CurrentItemIndex']=0;
 await assert.rejects(replaceUpcoming(f.client,'room',f.insert),/queue changed/);assert.equal(f.writes(),0);
});
test('a song that advances naturally during insertion is never removed',async()=>{
 const f=fixture();await replaceUpcoming(f.client,'room',async()=>{const result=await f.insert();f.advance();return result;});
 assert.deepEqual(f.removed,[[13n]]);
});
test('unconfirmed removal fails without retrying the mutation',async()=>{
 const f=fixture();f.noConfirm();await assert.rejects(replaceUpcoming(f.client,'room',f.insert),/did not confirm/);assert.equal(f.writes(),1);
});
