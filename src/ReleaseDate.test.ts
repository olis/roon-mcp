import test from 'node:test';
import assert from 'node:assert/strict';
import {BinaryWriter} from 'roon-library-controls/dist/src/wire.js';
import {ObjectGraph,type RoonObject} from 'roon-library-controls/dist/src/graph.js';
import {decodeDate,releaseMetadata} from './ReleaseDate.js';
const date=(year:number,month=0,day=0)=>new BinaryWriter().flexInt((year<<16)|(month<<8)|day).toBuffer();
test('decodes live Roon dates and preserves partial dates',()=>{
 assert.deepEqual(decodeDate(Buffer.from([189,244,146,1])),{year:1981,month:9,day:1});
 assert.deepEqual(decodeDate(date(2004)),{year:2004,month:null,day:null});
 for(const value of [undefined,Buffer.alloc(0),date(0),date(1981,13),date(1981,2,30),Buffer.concat([date(1981),Buffer.from([1])])])assert.equal(decodeDate(value),null);
});
test('original album date wins over reissue; compilation date is never a song date',()=>{
 const graph=new ObjectGraph();
 const album:RoonObject={oid:2n,typeId:1,typeName:'AlbumLite',fields:{'x::OriginalReleaseDate':date(1981),'x::ReleaseDate':date(2004)}};
 const track:RoonObject={oid:1n,typeId:2,typeName:'TrackLite',fields:{'x::Album':{$ref:2n}}};graph.objects.set(2n,album);
 assert.equal(releaseMetadata(graph,track).originalReleaseYear,1981);
 album.fields['x::IsCompilation']=true;
 assert.equal(releaseMetadata(graph,track).originalReleaseYear,null);
 assert.equal(releaseMetadata(graph,track).originalAlbumReleaseDate?.year,1981);
});
