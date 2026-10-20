import { BinaryReader } from 'roon-library-controls/dist/src/wire.js';
import { field, type ObjectGraph, type RoonObject } from 'roon-library-controls/dist/src/graph.js';

/** Roon NullDate packs year/month/day into a flexInt; zero month/day mean unknown. */
export function decodeDate(value: unknown): {year:number;month:number|null;day:number|null}|null {
 if(!Buffer.isBuffer(value)||!value.length)return null;
 try {
  const reader=new BinaryReader(value),packed=reader.flexInt();
  if(reader.remaining||packed<0)return null;
  const year=packed>>>16,month=(packed>>>8)&255,day=packed&255;
  if(year<1000||year>new Date().getFullYear()||month>12||day>31||(!month&&day))return null;
  if(month&&day&&new Date(Date.UTC(year,month-1,day)).getUTCDate()!==day)return null;
  return {year,month:month||null,day:day||null};
 }catch{return null;}
}
export function releaseMetadata(graph:ObjectGraph,track:RoonObject){
 const album=graph.deref(field(track,'Album'));
 const originalAlbumReleaseDate=decodeDate(field(album,'OriginalReleaseDate'));
 const albumReleaseDate=decodeDate(field(album,'ReleaseDate'));
 const isCompilation=field(album,'IsCompilation')===true||field(album,'IsVariousArtists')===true;
 // Album original dates describe the compilation itself, never its individual songs.
 return {source:'roon-internal',dateScope:'album',isCompilation,originalAlbumReleaseDate,albumReleaseDate,
  originalReleaseYear:isCompilation?null:originalAlbumReleaseDate?.year??null};
}
