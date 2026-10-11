import type {Snapshot,Player,Game,Lineup,GameReport,Career} from '../src/types';
export function createEngine(snapshot:Snapshot,options?:{present?:string[];size?:number;locks?:Record<string,number>;start?:string;end?:string;includeChien?:boolean}):{
  players():Player[];allPlayers():Player[];minimumPa():number;jersey(name:string):number|null;
  recent(name:string):{date:string;tag:string;stats:Player}[];
  career(name:string):Career;games():Game[];report(game:Game):GameReport;recommend():Lineup;
  logs():Record<string,unknown>[];isOfficial(name:string):boolean;
};
