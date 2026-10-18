import test from 'node:test';
import assert from 'node:assert/strict';
import { weekdayInsights, colourInsights } from '../src/visits/insights';
import type { VisitRecord } from '../src/visits/types';
const visit = (id: string, date: string, changes: Partial<VisitRecord> = {}): VisitRecord => ({
  schema: 1, id, path: 'Notebook/Visits/' + id + '.md', sourcePath: 'Notebook/Sources/Branch.md',
  visitDate: date, recordedAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z',
  observations: '', finds: '', nextTime: '', revision: 'revision', ...changes,
});
test('weekday outcomes separate zero purchases from unrecorded counts and scores', () => {
  const rows = [visit('a','2026-10-12',{itemsPurchased:0}), visit('b','2026-10-12',{itemsPurchased:4,haulPotential:5}),
    visit('c','2026-10-12',{haulPotential:3})];
  const monday=weekdayInsights(rows)[0]!;
  assert.equal(monday.visits,3);assert.equal(monday.knownCounts,2);assert.equal(monday.meanItems,2);
  assert.equal(monday.buyingPercentage,50);assert.equal(monday.scoreCount,2);assert.equal(monday.medianScore,4);
  assert.equal(monday.limitedCounts,true);assert.equal(weekdayInsights(rows)[1]!.meanItems,null);
});
test('weekday derives from visit date, independent of recording date and DST', () => {
  const rows=[visit('backdated','2026-03-29',{itemsPurchased:2}),visit('autumn','2026-10-25',{itemsPurchased:4})];
  const result=weekdayInsights(rows);assert.equal(result[6]!.visits,2);assert.equal(result[6]!.meanItems,3);assert.equal(result[0]!.visits,0);
});
test('five contributions remove limited flags without inventing scores for zero buys',()=>{
  const rows=Array.from({length:5},(_,i)=>visit(String(i),'2026-10-12',{itemsPurchased:i,haulPotential:3}));
  const result=weekdayInsights(rows)[0]!;assert.equal(result.limitedCounts,false);assert.equal(result.limitedScores,true);
  assert.equal(result.scoreCount,4);assert.equal(result.medianScore,3);
});
test('colour hints require two returns and ignore unchanged sightings within a run',()=>{
  const colours=['Blue','Blue','Green','Green','Blue','Blue','Green','Green','Blue','Blue'];
  const dates=['2026-09-07','2026-09-11','2026-09-14','2026-09-18','2026-09-21','2026-09-25','2026-09-28','2026-10-02','2026-10-05','2026-10-09'];
  const result=colourInsights(dates.map((date,i)=>visit(String(i),date,{stockColour:colours[i],colourEvidence:'confirmed'})));
  assert.equal(result.timeline.length,10);assert.equal(result.hints.length,1);
  assert.deepEqual(result.hints[0],{sourcePath:'Notebook/Sources/Branch.md',colour:'Blue',returns:2,minimumDays:14,maximumDays:14,
    medianDays:14,supportingDates:['2026-09-07','2026-09-21','2026-10-05'],includesSuspected:false});
});
test('conflicting same-day colours cannot create a hint and remain visible',()=>{
  const rows=['Blue','Green','Blue','Green','Blue'].map((colour,i)=>visit(String(i),'2026-10-'+String(i+1).padStart(2,'0'),{stockColour:colour,colourEvidence:'confirmed'}));
  rows.push(visit('conflict','2026-10-03',{stockColour:'Red',colourEvidence:'suspected'}));
  const result=colourInsights(rows);assert.equal(result.hints.length,0);assert.equal(result.conflictingDates.length,1);
  assert.equal(result.timeline.filter(row=>row.conflicting).length,2);
});
test('suspected evidence requires opt-in and unknown meanings never support hints',()=>{
  const rows=['Blue','Green','Blue','Green','Blue'].map((colour,i)=>visit(String(i),'2026-10-'+String(i+1).padStart(2,'0'),{stockColour:colour,colourEvidence:'suspected'}));
  assert.equal(colourInsights(rows).hints.length,0);
  assert.equal(colourInsights(rows,true).hints[0]!.includesSuspected,true);
  rows[2]!.colourEvidence='unknown';assert.equal(colourInsights(rows,true).hints.length,0);
});
test('colour histories stay separate by branch and preserve distinct colour names',()=>{
  const rows=['Blue','Green','Blue','Green','Blue'].map((colour,i)=>visit(String(i),'2026-10-'+String(i+1).padStart(2,'0'),{stockColour:colour,colourEvidence:'confirmed',
    sourcePath:i===2?'Notebook/Sources/Other.md':'Notebook/Sources/Branch.md'}));
  assert.equal(colourInsights(rows).hints.length,0);
  const labels=[' Blue ','Green','blue','GREEN','BLUE'].map((colour,i)=>visit('n'+i,'2026-10-'+String(i+1).padStart(2,'0'),{stockColour:colour,colourEvidence:'confirmed'}));
  assert.equal(colourInsights(labels).hints.length,1);labels[2]!.stockColour='Navy blue';assert.equal(colourInsights(labels).hints.length,0);
});

test('visit filters include child areas, use actual dates and search editable observations',async()=>{
 const {filterVisitRecords}=await import('../src/visits/insights');
 const areas=[{path:'Notebook/Localities/Town.md',name:'Town',parentPath:'',segments:['Town'],label:'Town'},
 {path:'Notebook/Localities/Town/Quarter.md',name:'Quarter',parentPath:'Notebook/Localities/Town.md',segments:['Town','Quarter'],label:'Town / Quarter'}];
 const places=[{path:'Notebook/Sources/Branch.md',name:'Charity',kind:'shop' as const,locality:areas[1]!.path,coordinates:null,properties:{town:'Town',address:'1 High Street'}}];
 const rows=[visit('old','2026-09-01',{observations:'Natural fibres'}),visit('new','2026-10-12',{observations:'Useful denim'})];
 assert.equal(filterVisitRecords(rows,places,areas,{areaPath:areas[0]!.path}).length,2);
 assert.deepEqual(filterVisitRecords(rows,places,areas,{from:'2026-10-01',query:'DENIM'}).map(v=>v.id),['new']);
 assert.equal(filterVisitRecords(rows,places,areas,{sourcePath:'Missing'}).length,0);
 assert.equal(filterVisitRecords(rows,places,areas,{query:'High Street'}).length,2);
 assert.throws(()=>filterVisitRecords(rows,places,areas,{from:'2026-02-30'}),/valid start/);
 assert.throws(()=>filterVisitRecords(rows,places,areas,{from:'2026-10-12',to:'2026-10-01'}),/end date/);
});
