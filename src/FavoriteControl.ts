import type {RoonLibraryClient,TrackInfo} from 'roon-library-controls';
import type {RoonObject} from 'roon-library-controls/dist/src/graph.js';
import type {RemotingClient} from 'roon-library-controls/dist/src/remoting.js';
import {Arg,buildArgs} from 'roon-library-controls/dist/src/args.js';

type Internal={awaitLibraryTrack(zone:string):Promise<RoonObject>;profileSooid():Buffer|undefined;serviceOid(name:string):bigint|undefined;remoting:RemotingClient};
function field(obj:RoonObject,name:string){return Object.entries(obj.fields).find(([key])=>key.endsWith('::'+name))?.[1];}
export async function resolvedFavorite(client:RoonLibraryClient,track:TrackInfo):Promise<boolean|null>{
 if(!track.inLibrary)return false;
 try{await (client as unknown as Internal).awaitLibraryTrack(track.zoneId);const current=client.trackForZone(track.zoneId);return current?.trackId===track.trackId?current.favorite:null;}catch{return null;}
}
/** Capture a library object, recheck the selected recording, then change only its favourite flag. */
export async function changeFavorite(client:RoonLibraryClient,zoneId:string,track:TrackInfo,favorite:boolean,recheck:()=>Promise<void>){
 const internal=client as unknown as Internal,target=await internal.awaitLibraryTrack(zoneId);
 if(String(field(target,'LibraryTrackId')??field(target,'TrackId'))!==track.libraryTrackId)throw Error('Favourite target changed. Nothing was changed.');
 await recheck();
 const profile=internal.profileSooid(),library=internal.serviceOid('Library');
 if(!profile||library===undefined)throw Error('Roon favourite service unavailable.');
 const result=await internal.remoting.callMethod(library,'Sooloos.Broker.Api.Library::FavoriteOrBan(System.Sooid, Sooloos.Broker.Api.TrackBase, Sooloos.Broker.Api.FavoriteBanState, Base.ResultCallback)',buildArgs([Arg.sooid(profile),Arg.ref(target.oid),Arg.enum(favorite?1:0)]));
 if(!result.success)throw Error('Roon did not accept the favourite change.');
}
