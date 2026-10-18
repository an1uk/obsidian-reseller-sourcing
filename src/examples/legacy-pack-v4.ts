import { stringify } from 'yaml';
import { parseExampleBase } from './base-data';
import type { VisitRecord } from '../visits/types';
import { writeVisitRecord } from '../visits/store';
import { defaultPlanningOptions } from '../outings/planning';
import type { OutingPlanningOptions } from '../outings/types';
import { DEFAULT_SETTINGS, type CaptureDraft, type Coordinates, type Settings } from '../types';
import * as currentAssets from './legacy-assets-v4';
import * as legacyAssets from './legacy-assets';
import { buildExamplePack as buildHistoricalExamplePack } from './legacy-pack-v3';
import { hashText, readNote, wiki, writeNote } from '../storage/markdown';
import { safeFileName, validateRootPath } from '../domain';

export const EXAMPLES_PACK_VERSION = 4;
export interface ExamplePack { files: Record<string,string>; settings: Settings; }
const FENCE=String.fromCharCode(96).repeat(3);
// Historical payloads cannot depend on future changes to live planner defaults.
const legacyPlanningDefaults=():OutingPlanningOptions=>({mode:'hours',date:'2026-10-17',departureTime:'09:00',timeZone:'Europe/London',start:null,end:{kind:'return'},defaultVisitMinutes:20,stopOverrides:{},estimates:{driveMultiplier:1.4,driveKph:30,walkMultiplier:1.2,walkKph:4.5,parkingMinutes:5}});
const CHECKED='2026-10-16';
const FICTION='> [!warning] Fictional practice data\n> Places, addresses, prices, reviews and observations here are invented. Pins illustrate map layout and are not real sourcing destinations.\n\n';
const towns=[
 {name:'Brindleford',children:['Riverside','Old Quarter'],pin:[52.55,-2.45],story:'An invented riverside town with compact charity-shop rows and a quieter old quarter. Shared parking is useful here; the pins illustrate relationships rather than real businesses.'},
 {name:'Merewick',children:['Station End','Orchard Hill'],pin:[52.59,-2.38],story:'An imaginary railway town with station-side rails, a community car park and suppliers beyond the centre. A pleasant public rating need not mean the stock fits your sourcing brief.'},
 {name:'Thimbleton',children:['Canal Ward','North Arcade'],pin:[52.63,-2.31],story:'A fictional canal town mixing charity branches, clothing suppliers and markets. Its closed branch and unpinned parking are deliberate examples of keeping uncertainty visible.'},
];
interface Seed {brand:string;street:string;category:string;stock:string;prices:string;finds:string;remember:string;aside:string;type?:string;}
const seeds:Seed[]=[
 {brand:'Second Sunrise',street:'11 Loom Lane',category:'wool knitwear and everyday jackets',stock:'The knitwear rail is grouped by colour, with wool mixed among acrylics. Most pieces are clean, but cuffs and pocket linings still need a deliberate inspection.',prices:'Knitwear GBP 4-8; jackets GBP 7-12; the premium rail begins near GBP 15.',finds:'A lambswool crew neck with its fabric label intact and a tidy chore jacket',remember:'Start with fabric labels, then inspect cuffs and pocket linings.',aside:'The cardigan section has the confidence of a department store and the floor space of a telephone box.'},
 {brand:'Pocket Change',street:'6 Platform Row',category:'menswear basics and outdoor layers',stock:'Menswear is compact but replenished in small batches. Fleece and walking trousers are more consistent than the louder fashion rail.',prices:'Shirts GBP 3-5; fleece GBP 5-8; shells GBP 8-14.',finds:'A lightweight fleece and a plain overshirt in excellent condition',remember:'Check zip sliders and waterproof coatings before trusting a familiar label.',aside:'Patience helps here, provided it is not confused with buying every checked shirt.'},
 {brand:'Kindred Threads',street:'22 Canal Walk',category:'linen, dresses and summer separates',stock:'The summer rail contains useful linen blends and mid-market dresses. Warm lighting disguises small marks on pale fabrics, so take promising pieces toward daylight.',prices:'Separates GBP 4-7; dresses GBP 7-11; selected linen near GBP 13.',finds:'A linen-blend skirt and a simple lined dress',remember:'Inspect underarms and pale fabric in daylight before joining the queue.',aside:'The lighting flatters everything, including a tea stain that would prefer to remain anonymous.'},
 {brand:'Turn Again',street:'4 Cobbler Square',category:'coats and practical footwear',stock:'Coats take most of the front wall. Shoes are neatly displayed, but heel lining and sole condition vary much more than the display suggests.',prices:'Coats GBP 10-18; shoes GBP 5-9; boots GBP 9-16.',finds:'A clean raincoat and barely worn leather loafers',remember:'Inspect heels, linings and sole flexibility; polish is not structural evidence.',aside:'There are enough coats for a small orchestra, though perhaps not in the same decade.'},
 {brand:'Good Stitches',street:'31 Orchard Rise',category:'quality womenswear and occasion pieces',stock:'Well spaced rails make condition checks easy. Useful fabrics appear, but occasionwear deserves a second look for makeup marks and pulled hems.',prices:'Blouses GBP 5-8; dresses GBP 9-16; premium pieces individually priced.',finds:'A silk-mix blouse and a restrained crepe dress',remember:'Read fabric labels and allow for cleaning before admiring the fancy hanger.',aside:'A persuasive mirror and a posh hanger appear to have formed a sales department.'},
 {brand:'Second Sunrise',street:'8 North Arcade',category:'denim and casual clothing',stock:'Denim arrives steadily, including small sizes and short lengths. Quiet straight-leg jeans are more promising than the conspicuous logo rail.',prices:'Jeans GBP 5-9; sweatshirts GBP 6-10; loud logos sometimes GBP 14.',finds:'Two clean pairs of straight-leg jeans and a heavyweight plain sweatshirt',remember:'Measure actual waists and check repaired crotch seams.',aside:'The graphic rail shouts while the useful denim gets on with the job.'},
 {brand:'Pocket Change',street:'19 Ferry Street',category:'children clothes and family basics',stock:'Children clothes are arranged by approximate age. Practical school layers are more consistent than decorative outfits, with occasional adult knitwear on the end rail.',prices:'Children separates GBP 1-3; bundles GBP 4-6; adult knitwear GBP 4-7.',finds:'A sturdy school-layer bundle and an adult cotton cardigan',remember:'Count bundle pieces and inspect knees, cuffs and name labels.',aside:'The age labels are helpful suggestions rather than binding agreements with their former owners.'},
 {brand:'Kindred Threads',street:'14 Signal Street',category:'shirts, trousers and office clothing',stock:'The workwear rail is dense, with natural fibres among easy-care pieces. Waist alterations and shortened hems make actual measurements essential.',prices:'Shirts GBP 3-6; trousers GBP 4-7; blazers GBP 8-13.',finds:'A cotton oxford shirt and well finished wool-mix trousers',remember:'Measure after alterations; the original size label may be telling a historical story.',aside:'The shirt rail has attended more meetings than anyone currently standing beside it.'},
 {brand:'Turn Again',street:'2 Lockside Court',category:'sportswear and technical tops',stock:'Sports tops are plentiful but technical fabrics vary in condition. A modest outdoor section is worth checking after the obvious logo pieces.',prices:'Training tops GBP 3-5; leggings GBP 4-7; midlayers GBP 7-11.',finds:'A merino-blend base layer and a tidy running half-zip',remember:'Inspect stretched fabric and waistbands in strong light.',aside:'An impressive logo cannot compensate for elastic that has quietly retired.'},
 {brand:'Good Stitches',street:'7 Market Steps',category:'bags, belts and small leather goods',stock:'Bags occupy a low shelf and a small locked case. Plain leather pieces can be more useful than elaborate display items, especially when the linings are sound.',prices:'Everyday bags GBP 5-10; leather bags GBP 10-18; belts GBP 2-5.',finds:'A sound crossbody bag and a useful leather belt',remember:'Check straps, zip ends, lining corners and odour before asking for a case item.',aside:'The display bag is wearing more hardware than a garden gate.'},
 {brand:'Coat of Kindness',street:'42 Apple Yard',category:'winter coats and substantial knitwear',stock:'Heavy knitwear and coats dominate the shop. Stock depth is good, but old wool pieces need a full moth and storage inspection rather than a glance at the brand.',prices:'Jumpers GBP 6-10; coats GBP 14-24; premium tickets require a margin check.',finds:'A dense wool cardigan and a clean padded coat',remember:'Inspect folded edges and price the entire condition, not the promising label.',aside:'A serious coat has been promoted to the mannequin and appears to be chairing the shop.'},
 {brand:'Second Sunrise',street:'16 Towpath Lane',category:'unusual fabrics and vintage-looking separates',stock:'Several eras share this rail with modern retro styling. Inside seams, fabric labels and construction give more useful clues than the first impression.',prices:'Skirts GBP 5-9; shirts GBP 4-8; selected vintage rail GBP 12-20.',finds:'A well constructed patterned skirt and a cotton shirt with good buttons',remember:'Inspect construction before describing an item as vintage.',aside:'Several decades share this rail and none has agreed to label itself properly.'},
 {brand:'Pocket Change',street:'3 Spindle Close',category:'budget basics and repairable workwear',stock:'This is the scruffier branch of the fictional chain. Low tickets sometimes justify one clear repair, but tired basics easily fill a bag without earning their place.',prices:'Basics GBP 2-4; workwear GBP 4-7; repair basket GBP 1-2.',finds:'An overshirt needing one button and a clean cotton utility vest',remember:'Limit repair projects to work that is quick, understood and priced into the decision.',aside:'The bargain basket is not an invitation to adopt every missing button.'},
 {brand:'Kindred Threads',street:'9 Blossom Parade',category:'small premium rails and everyday dresses',stock:'The premium rail is short and carefully presented. After restocking, the ordinary rail often has the more sensible buys and fewer ambitious tickets.',prices:'Everyday separates GBP 4-7; premium rail GBP 12-22; knitwear GBP 6-10.',finds:'An everyday dress and a fine-gauge knit from the ordinary rail',remember:'Compare premium tickets with condition and useful demand.',aside:'The premium rail enjoys its title; the ordinary rail occasionally does the actual work.'},
 {brand:'Good Stitches',street:'5 Copper Arcade',category:'historical coats and archived finds',stock:'This fictional branch is permanently closed. Older visits remain useful history, but they should not produce an active-map or shortlist journey.',prices:'Historical coats GBP 9-15 and knitwear GBP 4-7; these are not current prices.',finds:'An earlier wool coat and a simple cotton cardigan',remember:'Keep the closure flag until independently confirmed otherwise.',aside:'The best route to this branch now involves the history folder rather than the car.'},
 {brand:'Coat of Kindness',street:'26 Mill Lane',category:'tailoring and heavy trousers',stock:'Tailoring is unusually well sorted for a small branch. Jacket collars, trouser seats and matching suit pieces deserve attention before the ticket becomes tempting.',prices:'Jackets GBP 9-16; trousers GBP 5-9; suits GBP 16-28.',finds:'A restrained tweed jacket and heavy cotton trousers',remember:'Check actual measurements and matching fabric; a near-match is still two garments.',aside:'The tailoring rail is smart enough to make a shopping bag feel underdressed.'},
 {brand:'Rag & Bone Yard',street:'Unit 4 Carding Court',type:'Rag house',category:'mixed clothing by weight',stock:'An invented by-weight hall advertises visible sorting grades and an unsorted area. The cleaner mixed rail is a reasonable starting hypothesis, not a personally tested recommendation.',prices:'Illustrative mixed clothing GBP 4 per kg; minimum spend and selected-rail terms need confirmation.',finds:'No visit recorded; mixed everyday clothing is a listing claim only',remember:'Ask about grading, minimum spend, rejected items and VAT before sorting.',aside:'Mixed grade is not a secret promise of cashmere.'},
 {brand:'Bundle Bumble',street:'17 Bale Street',type:'Rag house',category:'appointment-only category bundles',stock:'A fictional appointment supplier advertises clothing bundles. The note distinguishes listing claims from stock that somebody has actually inspected.',prices:'Illustrative 10 kg category bundle GBP 55; premium bundles quoted separately.',finds:'No inspection, purchase or outcome has been recorded',remember:'Confirm appointment, grading definitions and whether the photographed sample represents the batch.',aside:'A pretty top layer does not volunteer information about the other nine kilograms.'},
 {brand:'Textile Tide',street:'Warehouse 2 Shuttle Way',type:'Rag house',category:'sorting tables and seasonal lots',stock:'The fictional listing offers open sorting sessions and seasonal overflow. Arrival times, capacity and practical sorting space remain questions for a first visit.',prices:'Illustrative sorting entry GBP 10 plus selected clothing by weight.',finds:'No visit recorded; useful categories remain a planning hypothesis',remember:'Ask about gloves, bag checks, payment and the final sorting cutoff.',aside:'Bring a plan for the sorting table; the table will not provide one.'},
 {brand:'Rewear Wholesale',street:'12 Threadworks Estate',type:'Wholesaler',category:'graded menswear lots',stock:'A fictional warehouse offers category lots with trade-style booking. Supplier descriptions have not yet become a tested sourcing judgement.',prices:'Illustrative 20-piece shirt lot GBP 85 before delivery; confirm VAT and mixed sizes.',finds:'No visit or purchasing record exists for this example',remember:'Confirm minimum order, collection slot, returns and whether photos show the actual lot.',aside:'Easy margin deserves a chair until grading, fees and garments have arrived.'},
 {brand:'Rail Ready Warehouse',street:'Unit 8 Needle Park',type:'Wholesaler',category:'outerwear lots with an unverified entrance',stock:'Outerwear lots are described in the fictional listing, but the source pin is deliberately missing. Address and contacts remain available for correction instead of inferring a map-centre destination.',prices:'Illustrative eight-piece outerwear lot GBP 72; packing and delivery are separate questions.',finds:'No visit recorded; location still needs verification',remember:'Confirm the collection entrance and appointment before setting a pin.',aside:'A warehouse can be large and still be difficult to find when nobody specifies the gate.'},
 {brand:'Saturday Loop Market',street:'Fabric Square',type:'Market',category:'rotating clothing stalls',stock:'This invented Saturday market has changing sellers. A useful regular stall could eventually merit its own branch-specific note; the market note should not pretend every stall is equally useful.',prices:'Illustrative garment tickets GBP 2-8; next week need not repeat this week.',finds:'No visit recorded; opening information is a dated listing snapshot',remember:'Check weather cancellations, stall hours and payment before travelling.',aside:'The best stall may be two tables, one flask and a determined tarpaulin.'},
 {brand:'The Button Bazaar',street:'Old Drapers Hall',type:'Market',category:'indoor pop-up rails',stock:'A clear event name does not provide trusted coordinates. The missing pin and incomplete hours are deliberate examples of retaining uncertainty.',prices:'Illustrative entry GBP 1 and clothing tickets GBP 3-10.',finds:'No visit recorded; no neighbourhood has been inferred from the building name',remember:'Confirm the event date, accessible entrance and unloading restrictions.',aside:'An excellent event from last month is as useful as a train that left yesterday.'},
 {brand:'Fix & Find Reuse',street:'33 Patchwork Yard',type:'Community reuse depot',category:'repairable workwear and reuse clothing',stock:'This fictional community workshop has a small clothing corner. Its custom source type avoids squeezing every source into Charity shop or Wholesaler.',prices:'Illustrative clothing GBP 1-6, with repair projects priced separately.',finds:'No visit recorded; the workshop may or may not fit the eventual sourcing brief',remember:'Ask what can be browsed and whether collection days differ from workshop hours.',aside:'The useful question is what can be repaired profitably, not how many projects fit in the boot.'},
];
const parkSeeds=[
 ['Riverside Short Stay',0,0,'paid','usually available','A fictional two-hour pay-and-display with its machine at the north end. Allow time to pay before walking to the shops; a riverside view is not an invented free tariff.'],
 ['Library Side Bays',0,1,'free','limited','Fictional ninety-minute bays with no return within two hours. Library events reduce availability. Use the pedestrian passage rather than carrying bags through the service lane.'],
 ['Mill Lane Overflow',0,1,'paid','often available','Fictional longer-stay overflow for a slower browse. The saved pin represents the entrance, not the centre of the whole car park.'],
 ['Station Goods Yard',1,0,'paid','usually available','Fictional shared station-side parking. Check the evening closure time before leaving bags in the car; walking then targets each source individually.'],
 ['Orchard Community Bays',1,1,'free','usually full','Fictional community bays are often occupied at lunchtime. Free is a tariff, not a promise of availability. The station lot is the predictable alternative.'],
 ['Apple Yard Collection Bays',1,1,'free','short-stay only','Fictional customer collection spaces need permission and are not unrestricted shopping parking. Twenty minutes becomes remarkably short when one cardigan needs a committee meeting.'],
 ['Canal Ward Shared Parking',2,0,'paid','usually available','Fictional shared parking for shops and supplier collections. The pedestrian exit is separate from the ramp; one note serves several sources rather than being copied repeatedly.'],
 ['North Arcade Roof Bays - pin pending',2,1,'paid','uncertain','The fictional roof parking entrance has not been pinned. Driving must keep this visible rather than silently substituting the shop. Confirm the height barrier and closing time.'],
] as const;
const round=(n:number)=>Math.round(n*1e6)/1e6;
const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const pinFor=(i:number):Coordinates=>{const town=towns[i%3],n=Math.floor(i/3);return[round(town.pin[0]+n*.00043),round(town.pin[1]+(n%3)*.00061)];};
const hoursFor=(i:number)=>['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day,n)=>day+', '+(n===6?'Closed':n===5?'10:00 to 16:00':i>=16&&n===0?'By appointment':'09:30 to 17:00'));
const listing=(i:number,pin:Coordinates|null=pinFor(i))=>'https://www.google.com/maps/place/Fictional_'+slug(seeds[i].brand)+'/'+(pin?'data=!4m5!3m4!1sEXAMPLE-BRANCH-'+(i+1)+'!8m2!3d'+pin[0]+'!4d'+pin[1]:'?query_place_id=EXAMPLE-BRANCH-'+(i+1));
const marked=(props:Record<string,unknown>,body:string)=>writeNote({...props,sourcing_example:true},FICTION+body);
const block=(view:string)=>FENCE+'charity-sourcing\nview: '+view+'\n'+FENCE+'\n\n';
function capture(d:CaptureDraft,v:1|2,description:string):string{
 return marked({sourcing_capture:1,template_version:v,capture_kind:'shop',...(v===2?{source_type:d.sourceType??'Charity shop'}:{}),
  google_name:d.name,address:d.address,google_maps_url:d.url,website:d.website??'',telephone:d.telephone??'',
  google_rating_raw:d.googleRating===null?'':String(d.googleRating),google_review_count_raw:d.googleReviewCount===null?'':String(d.googleReviewCount),
  google_hours_raw:d.hours,google_review_topics_raw:d.topics.map(s=>{const m=/^(.+) \(([\d,]+)\)$/.exec(s);return m?m[1]+', mentioned in '+m[2]+' reviews':s;}),captured_at:d.capturedAt},
  description+'\n\nPrepared fictional input for explicit review. It was not extracted from a browser and does not verify live Google selectors.\n');
}
function base(root:string,path:string,kind:'shop'|'parking'|undefined,area:string|undefined,vault:string,packVersion:number):string{
 const {baseText}=packVersion>=3?currentAssets:legacyAssets;
 const value=parseExampleBase(baseText(root,kind,area,vault));
 value.filters.and=value.filters.and.filter((s:string)=>s!=='note.sourcing_example != true');value.filters.and.push('note.sourcing_example == true');
 value.formulas.google_maps='if(note.google_maps_url || formula.has_location, link('+JSON.stringify('obsidian://charity-sourcing?vault='+encodeURIComponent(vault)+'&action=listing&path=')+' + formula.action_path, "Preview Google Maps"), "")';
 for(const view of value.views){view.notebookRoot=root;view.notebookBasePath=path;}
 return stringify(value,{lineWidth:0});
}
function visit(seed:Seed,i:number,pass:number):string{
 const dates=['2026-09-14','2026-10-02','2026-10-14'],times=['10:20','13:45','15:10'];
 const observation=pass===0?'First fictional look: '+seed.stock:pass===1?'A return visit gave a different slice of the rail. The useful focus was '+seed.category+', rather than treating every low ticket as an opportunity. '+seed.remember:'This third fictional visit was slower and more selective. '+seed.remember+' The current sourcing score is still a judgement, not an average of these entries.';
 const finds=pass===0?seed.finds+'. These are invented observations, not purchases or sales outcomes.':pass===1?'A second pass through '+seed.category+' produced one promising example and several sensible rejections. No purchasing record is created here.':'The best fictional result was a small, well checked selection; almost-right pieces stayed on the rail. '+seed.finds+' illustrate useful detail to retain.';
 const next=pass===0?seed.remember+' Compare a later visit with this first impression.':pass===1?'Start with '+seed.category+' and keep the price guide in mind: '+seed.prices:'Keep the browse short unless the relevant rail has changed. '+seed.aside;
 return'### '+dates[pass]+' '+times[pass]+'\n\nVisit date: '+(i===5&&pass===2?'2026-09-28':dates[pass])+'\n\n**Observations**\n\n'+observation+'\n\n**Useful finds**\n\n'+finds+'\n\n**Next time**\n\n'+next+'\n\n';
}


/** New pack only: individual editable visits keep measurements out of source frontmatter. */
function separateVisitRecords(root:string,paths:string[]):Map<number,VisitRecord[]>{
 const records=new Map<number,VisitRecord[]>(),mondayCounts=[2,3,2,4,3],mondayScores=[2,3,2,3,3],fridayCounts=[6,5,7,4,8],fridayScores=[4,4,5,4,5];
 const focalDates=['2026-09-14','2026-09-18','2026-09-21','2026-09-25','2026-09-28','2026-10-02','2026-10-05','2026-10-09','2026-10-12','2026-10-16'];
 const colours=['Blue','Green','Blue','Green','Blue'];
 for(let i=0;i<16;i++){
  const values:VisitRecord[]=[],seed=seeds[i],count=i===0?10:2;
  for(let pass=0;pass<count;pass++){
   const week=Math.floor(pass/2),friday=pass%2===1;
   let visitDate=i===0?focalDates[pass]:'2026-10-'+String((pass?9:2)+i%5).padStart(2,'0');
   if(i===2&&pass===1)visitDate='2026-10-15';
   if(i===5&&pass===1)visitDate='2026-09-28';
   if(i===6)visitDate='2026-10-08';
   if(i===12)visitDate='2026-10-07';
   if(i===15)visitDate=pass?'2026-09-04':'2026-08-31';
   const recordedDate=i===0&&pass>=8||i===5&&pass===1?'2026-10-17':visitDate;
   const recordedAt=i===2&&pass===1?'2026-10-15T13:00:00.000Z':recordedDate+'T'+(pass%2?'15:10':'10:20')+':00.000Z';
   const id='example-visit-'+String(i).padStart(2,'0')+'-'+String(pass+1).padStart(2,'0');
   const path=root+'/Visits/'+visitDate.slice(0,4)+'/'+visitDate.slice(5,7)+'/'+visitDate+' - '+safeFileName(seed.brand+' - '+towns[i%3].name)+' - '+id+'.md';
   const legacy=visit(seed,i,Math.min(pass,2));
   const section=(name:string,next:string)=>legacy.split('**'+name+'**\n\n')[1].split(next?'\n\n**'+next+'**':'\n\n')[0].trim();
   let observations=section('Observations','Useful finds'),finds=seed.finds+'. These are fictional observations and manually invented counts; no real purchases or sales are recorded.',nextTime=section('Next time','');
   let itemsPurchased:number|undefined=(i+pass)%5+1,haulPotential:number|undefined=(i+pass)%5+1,stockColour:string|undefined,colourEvidence:VisitRecord['colourEvidence']='unknown';
   if(i===0){
    itemsPurchased=(friday?fridayCounts:mondayCounts)[week]!;haulPotential=(friday?fridayScores:mondayScores)[week]!;
    stockColour=colours[week]!;colourEvidence='confirmed';
    observations='Fictional week '+(week+1)+' '+(friday?'Friday':'Monday')+' browse: '+seed.stock+' I directly noted '+stockColour+' on the ticket, without assuming what it means or how often it changes. '+(friday?'The larger, useful selection earned its whole-haul judgement.':'The quieter selection stayed selective; low tickets were not a buying instruction.')+' '+seed.aside;
    finds=itemsPurchased+' fictional pieces bought, including '+seed.finds.toLowerCase()+'. Whole-haul potential '+haulPotential+'/5 is one opinion about the batch, not a price forecast or an average of item scores.';
    nextTime='Compare another actual visit, count even an empty bag and record the observed ticket label. Five weeks of invented observations are not a promise about future stock. '+seed.remember;
    if(pass===8)observations+=' Written up on Saturday 17 October for the Monday 12 October visit: weekday comparison must use the visit date.';
   }else if(i===1){itemsPurchased=pass?2:1;haulPotential=5;observations+=' Strong potential from very few pieces. The label said cashmere. The washing instructions strongly disagreed; that particular candidate stayed behind.';}
   else if(i===2){itemsPurchased=pass?9:12;haulPotential=pass?2:1;observations+=' A bulky fictional bag of ordinary basics gives quantity without much potential. The boot is full; the margin is not impressed.';}
   else if(i===3){itemsPurchased=0;haulPotential=undefined;observations+=' I counted an empty bag. Zero is known, not missing; there is no purchased haul to score. Restraint was the best find.';}
   else if(i===4){itemsPurchased=pass?4:undefined;haulPotential=pass?undefined:3;observations+=pass?' Count known, whole-haul potential left blank rather than inferred.':' The count was not recorded; a blank does not mean zero. The independent whole-haul opinion is retained.';}
   else if(i===5){itemsPurchased=pass?3:2;haulPotential=pass?4:2;observations+=pass?' Retrospective entry: written on 17 October for 28 September. The explicit last-visited date stays 2 October.':'';}
   if(i===6){stockColour=pass?'Yellow':'Red';colourEvidence='confirmed';observations+=' Two fictional notes disagree about the label on the same visit date. Both remain visible; that date must be excluded from colour recurrence.';}
   if(i===7){stockColour='Amber';colourEvidence=pass?'unknown':'suspected';observations+=' The label was not clearly verified. Suspected and unknown evidence are not confirmed observations.';}
   if(i===8||i===9){stockColour=i===8?'Blue':'Cream';colourEvidence='confirmed';observations+=' The same label was still present. An unchanged sighting is one run, not a new return.';}
   if(i===10){stockColour=pass?'Purple':undefined;colourEvidence=pass?'suspected':'unknown';observations+=' Missing or uncertain label information is kept explicit; it is not inferred from the colour of the garment.';}
   if(i===12){stockColour=pass?'Green':'Blue';colourEvidence=pass?'suspected':'confirmed';observations+=' Confirmed and suspected notes disagree on the same date. Excluding suspected evidence must not turn a conflicting day into a confirmed recurrence.';}
   if(i===15&&pass===0){observations='Fictional quick note: the tailoring rail looked promising, but I only had time to check two jacket linings. Return with a tape measure; confidence is not a measurement.';finds='';nextTime='';itemsPurchased=undefined;haulPotential=undefined;}
   const record:VisitRecord={schema:1,id,path,sourcePath:paths[i],visitDate,recordedAt,updatedAt:recordedAt,observations,finds,nextTime,
    ...(itemsPurchased===undefined?{}:{itemsPurchased}),...(haulPotential===undefined?{}:{haulPotential}),...(stockColour?{stockColour}:{}),colourEvidence,sourcingExample:true,revision:''};
   if(i===2&&pass===1){record.outingPath=root+'/Outings/Thimbleton coats and curios.md';record.outingId='example-outing-3';record.stopId='example-stop-3-0-0';}
   values.push(record);
  }
  records.set(i,values);
 }
 return records;
}
const demonstrates=(body:string)=>'> [!example]- What this demonstrates\n> '+body+'\n\n';
function addVisitExamples(files:Record<string,string>,root:string,records:Map<number,VisitRecord[]>):void{
 for(const visits of records.values())for(const record of visits){
  const note=readNote(writeVisitRecord(record));
  files[record.path]=marked(note.properties,note.body+'\n'+demonstrates(record.sourcePath===records.get(0)![0].sourcePath?'One of ten comparable visits: weekday uses the actual visit date; item count and whole-haul potential remain separate. Confirmed label observations describe evidence, not a restocking timetable.':'An editable separate visit with its own recording time, actual visit date and optional measurements. Source judgement, shortlist and Google snapshots remain independent.'));
 }
 files[root+'/Visits.md']=marked({cssclasses:['charity-sourcing-wide'],tags:['sourcing-example-visits']},
  block('visits')+demonstrates('Forty fictional visits live in year/month folders. Browse All visits, This week, Previous week or Custom dates; choose Insights for weekday and stock-colour comparisons. Example dates cover August to October 2026, so Custom dates remains useful whenever you open this pack.')+
  '[['+root+'/Reference/Visit comparisons and colour evidence|Worked comparisons]] · [['+root+'/Reference/Everyday workflows|Everyday workflows]]\n');
 files[root+'/Reference/Visit comparisons and colour evidence.md']=marked({tags:['sourcing-example-reference']},
  'Start with [['+root+'/Visits|Visits and insights]]. All measurements and observations are invented. Every source links to its own editable visits through the place controls.\n\n'+
  '## Compare actual visits\n\nSecond Sunrise on Loom Lane has five Mondays and five Fridays over five weeks. Monday item counts are 2, 3, 2, 4, 3 with whole-haul potential 2, 3, 2, 3, 3. Friday counts are 6, 5, 7, 4, 8 with potential 4, 4, 5, 4, 5. The resulting means are 2.8 and 6, and the median scores are 3 and 4. One Monday was written up on a Saturday; the comparison still uses Monday.\n\n'+
  'A one-piece strong haul and a large weak haul show why quantity and potential are separate. Zero-count visits remain in count summaries and buying frequency; their absent haul score is not invented. Missing counts and missing scores stay blank. Smaller samples are labelled as limited evidence. The source sourcing score remains your separate current judgement.\n\n'+
  '## Label evidence and uncertainty\n\nThe focal diary records Blue, Green, Blue, Green, Blue over five weeks, confirmed on both visit days. Unchanged sightings are collapsed before counting returns. Blue has two observed 14-day returns; Green has only one. These are retrospective gaps, not a predicted stock or discount schedule.\n\n'+
  'Other sources include an unchanged label, suspected and unknown labels, a missing label, and two notes that disagree on the same date. Conflicts are excluded before evidence filtering, so hiding a suspected note cannot make a conflicting day safe. Labels are user observations; nothing is inferred from garment colour, note colour or Google reviews.\n\n'+
  '## Outing examples\n\nThe finished Thimbleton outing links one visited stop to its detailed visit. Another visited stop deliberately has no recorded details. The active Merewick outing retains an unfinished draft; it is not counted as a saved visit. Resuming, cancelling or undoing progress must preserve the separate visit records.\n\n'+
  demonstrates('Edit a visit, then return to its source or the Visits hub. The same controls, validation and stale-edit safeguards apply in this isolated notebook. Editing examples does not change real notes, and fictional links remain previews.') );
 files[root+'/Reference/Legacy visit history.md']=marked({tags:['sourcing-example-reference']},
  'This is a worked illustration, not a conversion action. New examples use separate visits in year/month folders; old source notes and existing v1/v2 examples keep their inline histories unchanged.\n\n'+
  '## Before: existing source history\n\n'+FENCE+'markdown\n## Visit log\n\n### 2026-10-17 10:20\n\nVisit date: 2026-09-28\n\n**Observations**\n\nA fictional rail inspection, recorded later.\n'+FENCE+'\n\n'+
  '## After: a newly recorded separate visit\n\nUse Add visit and review the actual visit date, observations and any optional measurements yourself. The result is a linked visit note under Visits, while the original source prose stays intact. Existing dates, counts, haul scores and label meanings are never inferred from old prose. Recording new structured details does not silently migrate or delete earlier history. Avoid recording the same visit twice when maintaining your real notebook.\n\n'+
  'The finished outing demonstrates one linked detailed visit and one visited-without-details stop. A legacy visited stop without structured details stays a progress fact, not a guessed item count or score.\n\n'+
  demonstrates('Legacy and new history can coexist. This illustration creates no extra visit record and does not change the forty-record example inventory.'));
 files[root+'/Reference/Overview.md']+='\n- [['+root+'/Reference/Legacy visit history|Legacy visit history: before and after]]\n';
 files[root+'/Guided tour/Visit comparisons.md']=marked({tags:['sourcing-example-optional']},
  'This page is optional. Open [['+root+'/Visits|Visits and insights]], filter to Second Sunrise on Loom Lane, and compare Monday with Friday. Open the backdated Monday note to see why its recording day does not change its weekday.\n\n'+
  'Toggle suspected evidence, inspect the conflicting-date records and compare a small strong haul with a large weak one. Change one fictional count and see the comparison update. The source rating remains independent.\n\n'+
  'The label pattern contains two observed Blue returns and one Green return. Try changing one confirmed observation to suspected, then review how the evidence changes without predicting a future change date.\n');
}

/** Pure deterministic content; the manager owns explicit installation and state. */
export async function buildExamplePack(requestedRoot:string,vaultName:string,packVersion=EXAMPLES_PACK_VERSION):Promise<ExamplePack>{
 if(![1,2,3,4].includes(packVersion))throw new Error('This example pack version is not supported. Preserve its files.');
 if(packVersion<=3)return buildHistoricalExamplePack(requestedRoot,vaultName,packVersion);
 const root=validateRootPath(requestedRoot),files:Record<string,string>={},settings=structuredClone(DEFAULT_SETTINGS);
 const {ASSET_VERSION,bodyForPlace,bundledAssets,placeProperties}=packVersion>=3?currentAssets:legacyAssets;
 settings.root=root;settings.setupVersion=ASSET_VERSION;settings.sourceTypes.push('Community reuse depot');
 const supplied=bundledAssets(root,vaultName);
 for(const[path,text]of Object.entries(supplied)){
  if(path.endsWith('.base'))files[path]=base(root,path,path.endsWith('/Parking.base')?'parking':'shop',undefined,vaultName,packVersion);
  else if(!path.endsWith('/Guide.md')){const note=readNote(text);files[path]=path===root+'/Home.md'?writeNote({...note.properties,sourcing_example:true},note.body):marked(note.properties,note.body);}
 }
 files[root+'/Guide.md']=marked({tags:['sourcing-example-guide']},
  'These are ordinary editable practice records. Browse in any order, change a rating, add a visit or make an outing. The main notebook is separate.\n\n'+
  'Different source types, repeated charity brands, shared parking, a closed source, missing pins, backdated visits and incomplete captures are intentional. Current sourcing scores and invented Google snapshots are independent.\n\n'+
  'Navigation controls preview destinations and URLs; they do not launch directions or call fictional businesses. The map background is real, while the named places and observations are invented.\n\n'+
  'The six prepared clips use the normal create and refresh review forms. Review is explicit, not an automatic popup. No practice Web Clipper export or live browser capture route is installed.\n\n'+
  'Forty invented visits show separate recording and visit dates. Saving another visit uses the actual time you write it; last visited and shortlist stay explicit choices.\n\n'+
  'Browse [['+root+'/Reference/Overview|Reference overview]] for worked illustrations of setup, ownership, organisation, attachment, sync and recovery. They are not claims that those operations happened on your devices.\n\n'+
  'This pack is installed only when requested. Restarting, repairing or updating the main notebook does not recreate deleted example content or the optional reading folder.\n');
 files[root+'/Settings.md']=marked({tags:['sourcing-example-settings']},block('settings')+'Practice preferences do not change the main notebook default source type or remembered areas.\n');
 const areas:string[][]=[];
 for(const[ti,town]of towns.entries()){
  const townPath=root+'/Localities/'+town.name+'.md';areas[ti]=[townPath];
  files[townPath]=marked({tags:['sourcing-locality'],parent_locality:''},block('locality')+town.story+'\n\n'+town.children.map(child=>'[['+root+'/Localities/'+town.name+'/'+child+'|'+child+']]').join(' | ')+'\n');
  for(const child of town.children){
   const path=root+'/Localities/'+town.name+'/'+child+'.md';areas[ti].push(path);
   files[path]=marked({tags:['sourcing-locality'],parent_locality:wiki(townPath)},block('locality')+child+' is an invented part of '+town.name+'. Its views contain assigned practice sources and shared parking. The parent town groups both neighbourhoods; this note keeps a smaller area easy to browse.\n\nA premises name alone is not used as evidence of a locality. Pins demonstrate the hierarchy rather than real street knowledge.\n');
  }
  for(const[ci,area]of areas[ti].entries())for(const folder of['Sources','Parking']){
   const path=root+'/'+folder+'/'+town.name+(ci?'/'+town.children[ci-1]:'')+'/Area map.base';files[path]=base(root,path,undefined,area,vaultName,packVersion);
  }
 }
 settings.recentLocalities=[areas[0][1],areas[1][1],areas[2][2]];
 settings.areaHints=[
  {id:'example-riverside',phrase:'Riverside Arcade',townPath:areas[0][0],localityPath:areas[0][1],enabled:true},
  {id:'example-station',phrase:'Station Galleries',townPath:areas[1][0],localityPath:areas[1][1],enabled:true},
  {id:'example-disabled',phrase:'Old Market Hall',townPath:areas[0][0],localityPath:areas[0][2],enabled:false},
  {id:'example-conflict-a',phrase:'Canal Mills',townPath:areas[2][0],localityPath:areas[2][1],enabled:true},
  {id:'example-conflict-b',phrase:'Canal Mills',townPath:areas[2][0],localityPath:areas[2][2],enabled:true},
 ];
 const postcodes=['BF1 1AA','MW2 2BB','TT3 3CC'];
 const paths=seeds.map((seed,i)=>{const town=towns[i%3],branch=Math.floor(i/3)%3;return root+'/Sources/'+town.name+(branch===2?'':'/'+town.children[branch])+'/'+safeFileName(seed.brand+' - '+town.name+' - '+seed.street+' - '+postcodes[i%3])+'.md';});
 const parks=parkSeeds.map(seed=>root+'/Parking/'+towns[seed[1]].name+'/'+towns[seed[1]].children[seed[2]]+'/'+safeFileName(seed[0])+'.md');
 const linked=seeds.map((_,i)=>{if(i%7===6)return[];const ti=i%3,p=ti===0?(i%5===0?2:0):ti===1?(i%5===0?5:3):6,a=ti===0?1:ti===1?4:7;return i%4===0?[p,a]:[p];});
 const drafts:CaptureDraft[]=[];
 const separateVisits=packVersion>=3?separateVisitRecords(root,paths):new Map<number,VisitRecord[]>();
 for(const[i,seed]of seeds.entries()){
  const town=towns[i%3],branch=Math.floor(i/3)%3,area=areas[i%3][branch===2?0:branch+1],pin=i===20||i===22?null:pinFor(i),type=seed.type??'Charity shop';
  const draft:CaptureDraft={captureId:'',kind:'shop',sourceType:type,name:seed.brand+' - '+(branch===2?town.name:town.children[branch]),
   address:seed.street+', '+(branch===2?'':town.children[branch]+', ')+town.name+' '+postcodes[i%3],
   url:listing(i,pin),website:'https://'+slug(seed.brand)+'.example.invalid/branches/'+slug(seed.street),telephone:'+44 1632 960'+String(i).padStart(3,'0'),coordinates:pin,
   googleRating:i===20?null:round(3.6+(i%7)*.2),googleReviewCount:i===20?0:18+i*13,
   topics:[seed.category+' ('+(5+i)+')','helpful staff ('+(12+i*2)+')','prices ('+(3+i%6)+')'],hours:i===22?[]:hoursFor(i),
   capturedAt:CHECKED+'T10:00:00Z',street:seed.street,postcode:postcodes[i%3],brandTag:slug(seed.brand)};
  const raw=capture(draft,2,'Archived original creation evidence for this fictional source; this is not an additional pending clip.');
  draft.captureId=await hashText(root+'/Capture inbox/Original '+String(i+1).padStart(2,'0')+' - '+slug(seed.brand)+'.md\n'+raw);drafts.push(draft);
  files[root+'/Capture archive/'+draft.captureId+'.md']=raw;settings.captureReceipts[draft.captureId]=paths[i]!;
  const props={...placeProperties('shop',area,type),tags:[...(placeProperties('shop',area,type).tags as string[]),'source/'+slug(seed.brand),'sourcing-example'],
   town:town.name,address:draft.address,website:draft.website,telephone:draft.telephone,google_name:draft.name,google_maps_url:draft.url,coordinates:pin??[],
   rating:[4,3.5,2,0,4.5,1,5,2.5,3,1.5,4,3.5,2,4.5,3,4,0,0,0,0,0,0,0,0][i],
   comments:i<16?'Focus on '+seed.category+'; '+seed.remember.charAt(0).toLowerCase()+seed.remember.slice(1):'Not personally visited. '+seed.remember,
   shortlist:[0,1,4,7,10,16,18,21,23].includes(i),last_visited:packVersion>=3?(separateVisits.get(i)?.map(visit=>visit.visitDate).sort().at(-1)??null):i<8?(i===5?'2026-10-02':'2026-10-14'):i<16?'2026-10-02':null,shop_closed:i===14,
   google_rating:draft.googleRating,google_review_count:draft.googleReviewCount,google_checked:CHECKED,google_hours:draft.hours,google_hours_checked:draft.hours.length?CHECKED:null,
   google_review_topics:draft.topics,google_review_topics_checked:CHECKED,source_capture_id:draft.captureId,
   parking_on_site:i>=16&&i<=20?'yes':'no',on_site_parking_cost:i>=16&&i<=20?'free':'unknown',on_site_parking_availability:i>=16&&i<=20?'confirm collection slot':'not applicable',
   parking_location:linked[i].length&&i%4!==0?wiki(parks[linked[i][0]]):''};
  if(i===1&&pin)props.coordinates=[round(pin[0]+.00009),round(pin[1]-.00007)];
  const count=packVersion>=3?0:i<8?3:i<16?2:0,entries=Array.from({length:count},(_,pass)=>visit(seed,i,pass)).reverse().join('');
  let body=bodyForPlace(draft).replace('## Visit log\n\n\n','## Visit log\n\n'+entries+'\n');
  body=body.replace('## Notes\n\n\n','## Notes\n\n### Stock and condition\n\n'+seed.stock+'\n\n### Typical prices\n\n'+seed.prices+'\n\n### Useful categories\n\n'+seed.category+'. '+seed.finds+'.\n\n### Remember next time\n\n'+seed.remember+'\n\n'+seed.aside+'\n\n'+(i===14?'This fictional branch is permanently closed. Preserve its history, but omit it from active maps and trips.\n\n':i===20||i===22?'The missing pin is intentional. A listing is not permission to substitute map-centre coordinates.\n\n':'')+(i===5?'The newest recorded entry describes an earlier visit. Last visited was explicitly kept at 2 October, independently of recording time.\n\n':''));
  if(packVersion>=3)body=body.replace(/## Visit log[\s\S]*?(?=## Notes)/,'')+'\n'+demonstrates(i===0?'Ten separate fictional visits compare five Mondays and five Fridays, including a backdated recording and observed Blue/Green label changes. Open Visits and insights; this source rating stays a separate current judgement.':i<16?'Two separate editable visits include optional counts, whole-haul potential and label evidence. Missing values stay unknown; source assessment and shortlist are independent.':'No visit is recorded. Listing claims and future intentions do not become sourcing outcomes.');
  files[paths[i]]=marked(props,body);
 }
 for(const[i,seed]of parkSeeds.entries()){
  const[name,ti,ci,cost,availability,notes]=seed,town=towns[ti],pin:Coordinates|null=i===7?null:[round(town.pin[0]+.00019+i*.00011),round(town.pin[1]-.00013-i*.00008)];
  const served=linked.flatMap((values,index)=>values.includes(i)?[index]:[]);
  const props={...placeProperties('parking',areas[ti][ci+1]),town:town.name,address:name+', '+town.children[ci]+', '+town.name+' (fictional)',
   coordinates:pin??[],google_name:name+' - fictional parking',google_maps_url:'',google_checked:CHECKED,website:'https://parking.example.invalid/'+slug(name),
   parking_cost:cost,parking_availability:availability,parking_checked:'2026-10-15',parking_for:served.map(index=>wiki(paths[index]))};
  const body=bodyForPlace(undefined,'parking').split('> [!info]')[0].replace('## Notes\n\n\n','## Notes\n\n'+notes+'\n\n### Sources served\n\n'+served.map(index=>'- '+wiki(paths[index])).join('\n')+'\n\n### Access and limits\n\nThese illustrative tariffs and usual availability are dated observations, not live parking information. Recheck restrictions in a real notebook. This reusable note can be selected independently for an outing without changing source preferences.\n');
  files[parks[i]]=marked(props,packVersion>=3?body.replace('## Visit log\n\n\n','')+'\n'+demonstrates('One reusable parking note can serve several sources, retain alternatives and be selected independently for an outing. Its tariff and availability are fictional dated observations.'):body);
 }
 const outings=[
  {name:'A pocket of Brindleford',status:'planned',groups:[[0,[0,3]],[1,[6,9]],[2,[12,15]]],note:'A compact fictional town outing with shared parking. Reorder its groups or change sources; permanent shortlists and preferred parking stay independent.'},
  {name:'The mixed-source circuit',status:'planned',groups:[[6,[17]],[7,[23]],[0,[18]],[3,[16]],[4,[19]],[-1,[21]]],note:'A longer fictional route across source types. The roof-bay pin is deliberately missing; correct it or exclude it explicitly in the route preview. The other destinations fit a larger Maps journey; choose Mobile browser to demonstrate multipart links. No directions are launched.'},
  {name:'Merewick lunch-break rails',status:'active',groups:[[3,[1,4]],[4,[7,10]],[5,[13]]],note:'An active fictional outing with visited and skipped stops plus an unfinished visit draft. The draft is not a saved source visit; normal controls can resume or discard it.'},
  {name:'Thimbleton coats and curios',status:'finished',groups:[[6,[2,5]],[7,[8,11]],[-1,[14]]],note:'Finished fictional history retains visited and skipped progress. A closed branch and missing parking pin illustrate why historical records differ from current destinations.'},
 ] as const;
 for(const[oi,seed]of outings.entries()){
  const groups=seed.groups.map(([pi,indices],gi)=>({id:'example-group-'+oi+'-'+gi,parkingPath:pi<0?'':wiki(parks[pi]),
   stops:indices.map((index,si)=>({id:'example-stop-'+oi+'-'+gi+'-'+si,sourcePath:wiki(paths[index]),
    status:oi===2&&gi===0&&si===0?'visited':oi===2&&gi===1&&si===0?'skipped':oi===3?(index===8?'skipped':'visited'):'pending',
    ...((oi===2&&((gi===0&&si===0)||(gi===1&&si===0)))||oi===3?{completedAt:'2026-10-15T13:00:00Z'}:{}),
    ...((oi===2&&gi===1&&si===0)||oi===3&&index===8?{skipReason:'Fictional example: no useful stock on this visit.'}:{})}))}));
  const outing={schema:1,id:'example-outing-'+oi,name:seed.name,status:seed.status,groups,createdAt:'2026-10-'+String(10+oi)+'T09:00:00Z',
   ...(packVersion>=2&&oi<2?{planning:{...(packVersion>=3?defaultPlanningOptions():legacyPlanningDefaults()),end:{kind:packVersion>=3&&oi===0?'last':'return'},date:'2026-10-17',departureTime:'09:00',timeZone:'Europe/London',start:{kind:'coordinates',coordinates:oi===0?[52.545,-2.46]:[52.60,-2.35],label:'Fictional starting point'},stopOverrides:oi===0?{'example-stop-0-0-0':{visitMinutes:30},'example-stop-0-1-1':{hours:{closed:false,intervals:[{open:'10:00',close:'16:30'}]}}}:{}}}:{}),
   ...(oi>=2?{startedAt:'2026-10-15T10:00:00Z'}:{}),...(oi===3?{finishedAt:'2026-10-15T15:00:00Z'}:{}),
   ...(oi===2?{draft:{operationId:'example-unsaved-visit-draft',stopId:'example-stop-2-0-1',input:{observations:'Fictional unfinished quick note: checked the ordinary rail, left the marked blouses behind. An empty bag is still useful information.',finds:'',nextTime:'',itemsPurchased:0,visitDate:'2026-10-16',updateLastVisited:false},updatedAt:'2026-10-16T12:40:00Z'}}:{})};
  if(packVersion>=3&&oi===3){const detailed=separateVisits.get(2)![1];Object.assign(groups[0].stops[0],{visitPath:wiki(detailed.path),visitId:detailed.id});}
  files[root+'/Outings/'+safeFileName(seed.name)+'.md']=marked({tags:['sourcing-outing'],cssclasses:['charity-sourcing-outing'],outing},block('outing')+'## Notes\n\n'+(packVersion===1?seed.note.replace('The other destinations fit a larger Maps journey; choose Mobile browser to demonstrate multipart links.','Five other destinations show multipart links.'):seed.note)+'\n');
 }
 const pending:[string,CaptureDraft,1|2,string][]=[
  ['01 - New source complete (v2)',{...drafts[0],captureId:'',name:'Spare Button Society - Riverside',address:'27 Loom Lane, Riverside, Brindleford BF1 4AA',url:'https://www.google.com/maps/place/Fictional_Spare_Button/data=!4m5!3m4!1sEXAMPLE-NEW-COMPLETE!8m2!3d52.551!4d-2.451',coordinates:[52.551,-2.451],website:'https://spare-button.example.invalid/',telephone:'+44 1632 960099',capturedAt:'2026-10-17T10:00:00Z',googleRating:4.2,googleReviewCount:27},2,'A complete fictional clip for a new source; normal creation should open.'],
  ['02 - New source missing details (v1)',{...drafts[0],captureId:'',name:'Odd Sock Exchange',address:'',url:'https://maps.app.goo.gl/EXAMPLE-NO-LOCATION',coordinates:null,website:'',telephone:'',googleRating:null,googleReviewCount:null,hours:[],topics:[],capturedAt:'2026-10-17T10:10:00Z'},1,'An incomplete fictional legacy clip; town and pin are unknown, not inferred.'],
  ['03 - Refresh complete',{...drafts[0],name:'Second Sunrise - Riverside textile room',website:'https://second-sunrise.example.invalid/updated',telephone:'+44 1632 960080',url:listing(0,[52.55025,-2.44975]),coordinates:[52.55025,-2.44975],googleRating:4.7,googleReviewCount:88,topics:['wool knitwear (26)','helpful staff (42)','prices (14)'],hours:hoursFor(0).map(row=>row.replace('09:30','09:00')),capturedAt:'2026-10-17T11:00:00Z'},2,'A complete refresh; changed pin stays unchecked by default.'],
  ['04 - Refresh partial',{...drafts[1],address:'',website:'',telephone:'',googleRating:4.9,googleReviewCount:null,hours:['Monday, 10:00 to 16:00'],topics:['outdoor layers (7)'],capturedAt:'2026-10-17T11:15:00Z'},2,'A partial refresh; half a review pair and incomplete hours cannot erase current information. The manually corrected source pin remains independent.'],
  ['05 - Refresh older snapshot',{...drafts[2],googleRating:3.8,googleReviewCount:14,topics:['dresses (3)','prices (2)'],capturedAt:'2026-06-12T10:00:00Z'},1,'An older snapshot; checked-date warnings matter before selecting updates.'],
  ['06 - Refresh no change',{...drafts[3]},2,'An exact repeat; Keep existing and archive capture can dismiss it without changing assessment.'],
 ];
 for(const[name,draft,version,description]of pending){
  const path=root+'/Capture inbox/'+name+'.md',raw=capture(draft,version,description);files[path]=raw;
  settings.captureSnapshots[path]={captureId:await hashText(path+'\n'+raw),revision:await hashText(raw)};
 }
 references(files,root,packVersion);
 addEverydayExamples(files,root,paths);
 if(packVersion>=3){
  addVisitExamples(files,root,separateVisits);
  files[root+'/Reference/Journey planning.md']=files[root+'/Reference/Journey planning.md'].replace('and return-to-start planning.','with one last-source finish and one explicit return to start.');
  for(const path of Object.keys(files).filter(path=>path.startsWith(root+'/Outings/')&&path.endsWith('.md')))files[path]+='\n'+demonstrates('Outing progress stays independent from source shortlist and separate visit details. One finished stop links its saved visit; visited-without-details and the active unfinished draft remain distinct.');
  for(const path of[root+'/Guide.md',root+'/Reference/Overview.md'])files[path]+='\n'+demonstrates('Browse [['+root+'/Visits|Visits and insights]] for forty separate editable visits, weekday comparisons and observed stock-label evidence. The optional guide points to the same records and can be deleted independently.');
 }
 for(const[path,text]of Object.entries(files))if(path.endsWith('.base')||Object.hasOwn(supplied,path)||path===root+'/Settings.md')settings.assets[path]={hash:await hashText(text),version:ASSET_VERSION};
 return{files,settings};
}
function references(files:Record<string,string>,root:string,packVersion:number):void{
 const ref=(name:string,body:string)=>{files[root+'/Reference/'+name+'.md']=marked({tags:['sourcing-example-reference']},body);};
 const names=[...(packVersion>=2?['Journey planning']:[]),'Setup and ownership','Organisation before and after','Attachment and sync','Recovery and raw evidence','Web Clipper and platform boundaries','Navigation and map behaviour'];
 ref('Overview','Browse these worked pages independently. They illustrate states and boundaries; they are not a sequence, task list or claim that an operation happened on your devices.\n\n'+names.map(name=>'- [['+root+'/Reference/'+name+'|'+name+']]').join('\n')+'\n\nThe actual editable records are in [['+root+'/Sources|Sources]], [['+root+'/Parking|Parking]], [['+root+'/Localities|Areas]] and [['+root+'/Outings|Outings]].\n');
 if(packVersion>=2)ref('Journey planning','The two planned outings have fictional starting pins, a 09:00 departure, 20-minute default visits and return-to-start planning. A pocket of Brindleford also shows a longer visit and a date-specific hours override. Use Plan journey to compare arrival, waiting, closing conflicts and distance; no proposal is applied until you choose it.\n\nThe mixed-source circuit deliberately has missing parking coordinates. Fix those before planning, or use the ordinary route preview with explicit exclusion. Try Android app or Desktop for a larger single journey, then Mobile browser for numbered parts. A return point consumes one destination slot.\n\nAll distances and times are local estimates, not road routing or live traffic. The weekly snapshots and their checked dates are fictional. Appointment-only and ambiguous hours remain unconfirmed. Practice changes and fictional destination previews stay inside Examples.\n');
 ref('Setup and ownership','## Before: an empty notebook\n\n'+FENCE+'text\nExample notebook/\n  (empty)\n'+FENCE+'\n\n## After: supplied components and a personal edit\n\n'+FENCE+'text\nExample notebook/\n  Home.md                 current supplied component\n  Guide.md                personally edited; preserve it\n  System/Sources.base     current supplied component\n  Templates/Source.md     insertion source\n'+FENCE+'\n\nActual ownership follows exact generated bytes. A modified Guide is a conflict to preserve, not permission to overwrite it. Missing and edited components are different findings. Opening this page does not run setup or repair.\n\nThe working preferences are in [['+root+'/Settings|Practice settings]]. Examples is installed explicitly and is not recreated by ordinary setup, repair or plugin updates.\n');
 ref('Organisation before and after','## Before: town only\n\n'+FENCE+'text\nSources/Brindleford/Second Sunrise.md\nLocalities/Brindleford.md\n'+FENCE+'\n\n## After: a locality inside its town\n\n'+FENCE+'text\nSources/Brindleford/Riverside/Second Sunrise.md\nLocalities/Brindleford.md\nLocalities/Brindleford/Riverside.md\n'+FENCE+'\n\nThese are illustrative trees, not duplicate active records. Actual Change area previews a destination and affected links while retaining filename, visits and personal body. Moving one source does not move shared parking. Renaming or reparenting an area follows its subtree with verified backups.\n\nA parent-notebook move also carries Examples and its raw capture identities. This page does not execute a real root move. Practice organisation controls remain confined to practice files.\n');
 ref('Attachment and sync','## Before: notebook files and fresh local settings\n\nA second device can receive notebook files without copied plugin settings. Actual inspection reads and reports recognised records, modified components and capture identity questions.\n\n## After: explicit attachment\n\nUse existing notebook rechecks its preview fingerprint before storing the chosen root locally. It does not repair, move or rewrite notes. Ownership is recovered only for exact current component bytes.\n\nThis is a worked description, not evidence of sync. The plugin supplies no transport. Real desktop-to-phone-to-desktop acceptance requires the chosen service, completed transfers, a fresh connection and observed returning changes. A copied fixture or screenshot cannot establish that.\n\nUnknown captures are not matched by shop name. Ambiguous or changed raw evidence remains available for originating-device review.\n');
 ref('Recovery and raw evidence','## Before: a source decision saved, archiving unfinished\n\nA refresh can save selected fields and a portable receipt while its raw clip is still in the inbox. The receipt binds capture identity, raw revision and chosen fields; it is not another source record.\n\n## After: receipt verified and original archived\n\nFinish archiving completes the remaining work without replaying source changes. Raw archives retain exact bytes, including relative links. Verified move backups support narrow recovery; conflicting concurrent edits stop for review rather than broad restoration.\n\nThese are worked recovery states, not a manufactured disk failure. The prepared clips exercise actual capture review, while archived originals provide real in-pack evidence for the invented sources.\n\nAn outing draft is different: it retains unfinished text without creating a source visit. The active Merewick outing contains an editable draft; discarding it leaves earlier source visits alone.\n');
 ref('Web Clipper and platform boundaries','The real browser templates are Source v0.4.2 and Parking v0.4.2. Browser import, selectors, Chrome settings and extension storage are outside this practice notebook. No practice browser export or live capture route is supplied.\n\nThe six prepared v1/v2 clips show complete and incomplete creation, complete and partial refreshes, an older snapshot and an exact repeat. They exercise normal review, not live Google extraction or browser import.\n\nDesktop and Android share plugin release files. Android supports manual notes, visits, contacts, areas, shared parking and outings; browser extraction remains separate. A worked page cannot establish a physical keyboard, location permission, external handler or actual sync result.\n\nPurchasing, stock items, sales and outcomes stay outside this notebook. There is no paid API, automatic review-text harvesting, LyList importer or generated outcome report.\n');
 ref('Navigation and map behaviour','Pins illustrate layout over a real free map background. The businesses and addresses are invented. Navigation controls preview their destination and URL rather than launching fictional directions, websites or calls.\n\nDriving uses selected shared parking, walking uses the source and an outing has its own saved parking choice. Missing selected parking stays a problem; it must not silently become a source destination. One parking record can serve several sources and each source can retain alternatives.\n\nThe longer planned circuit has an unpinned parking choice and enough other groups for multipart routes after explicit exclusion. Previewing a part changes no progress. Straight-line ordering does not claim road times, traffic or optimisation.\n\nColours follow the half-step sourcing score: blue unrated, red below 2, amber below 4 and green from 4. Google scores and topics have separate checked snapshots. Closed sources remain in tables, and missing source pins remain in Needs location.\n\nTiles require connectivity. A Retry state is a resilience feature; this reference is not a manufactured WebGL failure. Actual map interactions remain available in the working views.\n');
 files[root+'/Guided tour/Start here.md']=marked({tags:['sourcing-example-optional']},'This optional folder is a collection of pointers, not a sequence to finish. Deleting it leaves the working notebook intact.\n\nA bright Google score need not win your sourcing judgement. Compare branches in [['+root+'/System/Sources.base#Review comparison|Review comparison]] or group by brand and area.\n\nBrowse [['+root+'/Localities/Brindleford/Riverside|Riverside]] for a small cluster. Parking notes show why free, available and convenient are different questions.\n\nThe Merewick outing has an unfinished draft; the Thimbleton outing retains finished history. Neither is a purchasing or sales ledger.\n');
 files[root+'/Guided tour/Capture examples.md']=marked({tags:['sourcing-example-optional']},'The prepared clips can be reviewed in any order. Exact listing identity chooses a saved branch; a similar name alone does not.\n\nThe complete refresh selects nonempty changes but not its pin. The partial refresh cannot replace a rating/count snapshot with half a pair. The older snapshot shows a warning; an exact repeat can be archived while keeping existing information.\n\nThese are working inputs for fictional sources. After saving, raw evidence is preserved and sourcing assessments, shortlists, visits and parking remain independent.\n');
}

/** Optional pointers to the same editable records, without adding a second task system. */
function addEverydayExamples(files:Record<string,string>,root:string,paths:string[]):void{
 const sourceLink=(index:number,label:string)=>'[['+paths[index].replace(/\.md$/,'')+'|'+label+']]';
 files[root+'/Reference/Everyday workflows.md']=marked({tags:['sourcing-example-reference']},
  'Start from [['+root+'/Home|Examples Home]]. It offers one saved task to continue, followed by Record a visit, Plan an outing and Find sources. Choosing something else is always available.\n\n'+
  '## Record only what helps now\n\nOpen '+sourceLink(3,'Turn Again')+' and add a visit. The date, items purchased and quick note are enough for a small record. Zero items is a useful result; the cardigan committee has adjourned without buying anything. Keep a draft if you want to finish later.\n\n'+
  'Haul and stock details, Finds and reminders, and Update source assessment expand when you need them. Saved values are shown when reopening a draft or visit. Source ratings and shortlist choices remain deliberate decisions.\n\n'+
  '## Continue an outing\n\n[['+root+'/Outings/Merewick lunch-break rails|Merewick lunch-break rails]] contains an unfinished visit. Home offers it as saved work; it is not counted as a completed visit. [['+root+'/Outings/A pocket of Brindleford|A pocket of Brindleford]] is ready to open or start, while [['+root+'/Outings/Thimbleton coats and curios|Thimbleton coats and curios]] is finished and offers Review visits for later detail.\n\n'+
  'Record a visit on Home starts a standalone source choice. Use the labelled current-outing action when you want the visit associated with that outing. Nothing starts or attaches automatically.\n\n'+
  '## Browse by week without deeper folders\n\n[['+root+'/Visits|Visits]] starts with readable history. This week and Previous week use Monday to Sunday. For these fixed fictional dates, choose Custom dates: 28 September to 4 October 2026 crosses a month boundary; 31 August to 6 September does too. Choose Insights separately for comparisons.\n\n'+
  '## Before and after: visit organisation\n\n'+FENCE+'text\nEarlier example packs: Visits/2026-09-28 - Source - identifier.md\nFresh examples:       Visits/2026/09/2026-09-28 - Source - identifier.md\n'+FENCE+'\n\nActual visit date selects the folder when creating a new note. Correcting its date later preserves the existing filename and path. Flat and nested records remain browseable together. Existing notes and earlier example packs are not moved, rewritten or restored by this release.\n\n'+
  demonstrates('The same production controls power these fictional records. All example actions stay in this notebook. The optional tour is only a set of links; deleting it does not remove any of these records.') );
 files[root+'/Reference/Overview.md']+='\n- [['+root+'/Reference/Everyday workflows|Everyday workflows and visit folders]]\n';
 files[root+'/Guided tour/Start here.md']=marked({tags:['sourcing-example-optional']},
  'Open [['+root+'/Home|Examples Home]] and choose what is useful now. This guide is optional, has no completion target and never opens automatically. Deleting this folder leaves the working notebook intact.\n\n'+
  'Try one small record at '+sourceLink(3,'Turn Again')+': record zero items and a quick note, or keep a draft and return from Home. Expand extra details only if they help.\n\n'+
  'Resume the saved work in [['+root+'/Outings/Merewick lunch-break rails|Merewick lunch-break rails]], open the planned [['+root+'/Outings/A pocket of Brindleford|Brindleford outing]], or review the finished [['+root+'/Outings/Thimbleton coats and curios|Thimbleton outing]]. The source shortlist and current rating stay independent.\n\n'+
  'Browse [['+root+'/Visits|Visits]] using Custom dates across September and October 2026; choose Insights for the five-Monday/five-Friday comparison. [['+root+'/Reference/Everyday workflows|Everyday workflows]] explains the available choices.\n\n'+
  'The rest is available through Browse notebook: compare Google and sourcing scores, group branches by brand, inspect shared parking or review a prepared fictional capture. There is no required order.\n');
}
