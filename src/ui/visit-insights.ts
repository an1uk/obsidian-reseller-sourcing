import { markInputModal, modalWindow } from './modal-layout';
import { Component, Modal, SuggestModal, TFile } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { VisitRecord } from '../visits/types';
import { weekdayInsights, colourInsights, filterVisitRecords } from '../visits/insights';
import { button, details, errorText, renderContextBanner } from '../ui';
import { StructuredVisitModal } from './visits';

export interface InsightsState { sourcePath?: string; areaPath?: string; from?: string; to?: string; query?: string; includeSuspected?: boolean; sort?: 'date'|'items'|'score'; coloursExpanded?: boolean; }
class Choice extends SuggestModal<{path:string;label:string}> {
  constructor(context:NotebookContext, private rows:{path:string;label:string}[], private choose:(path:string)=>void, title:string) { super(context.app);this.setPlaceholder(title); }
  getSuggestions(query:string) { return this.rows.filter(row=>row.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())); }
  renderSuggestion(row:{path:string;label:string},el:HTMLElement) {el.setText(row.label);}
  onChooseSuggestion(row:{path:string;label:string}) {this.choose(row.path);}
}
export class VisitInsightsModal extends Modal {
  private owner=new Component();private closed=false;private generation=0;private timer?:number;
  private state:InsightsState;
  constructor(private context:NotebookContext,sourcePath?:string) {super(context.app);this.state={sourcePath};}
  onOpen() { markInputModal(this);
    this.titleEl.setText('Visit insights');this.modalEl.addClass('charity-insights-modal');this.owner.load();void this.render();
    const refresh=()=>{modalWindow(this).clearTimeout(this.timer);this.timer=modalWindow(this).setTimeout(()=>void this.render(),180);};
    for(const event of ['create','modify','delete','rename'] as const) this.owner.registerEvent(this.context.app.vault.on(event as 'modify',refresh));
  }
  private async render() {
    const generation=++this.generation;
    try {await renderVisitInsights(this.context,this.owner,this.contentEl,this.state,()=>!this.closed&&generation===this.generation);}
    catch(error) {if(!this.closed&&generation===this.generation)this.contentEl.createEl('p',{text:errorText(error),cls:'charity-error'});}
  }
  onClose(){this.closed=true;this.generation++;modalWindow(this).clearTimeout(this.timer);this.owner.unload();}
}
export async function renderVisitInsights(context:NotebookContext,owner:Component,el:HTMLElement,state:InsightsState={},isCurrent=()=>true):Promise<void> {
  const [inspection,places,areas]=await Promise.all([context.store.visits.inspect(),context.store.listPlaces(),context.store.listLocalities()]);
  if(!isCurrent())return;el.empty();el.addClass('charity-insights');renderContextBanner(context,el);
  const sources=places.filter(place=>place.kind==='shop'),byPath=new Map(sources.map(source=>[source.path,source]));
  const name=(path:string)=>byPath.get(path)?.name??path.split('/').at(-1)?.replace(/\.md$/,'')??path;
  el.createEl('p',{text:'Compare recorded outcomes, not realised profit. Unknown purchase counts are separate from visits where nothing was bought.',cls:'charity-hint'});
  const filters=el.createDiv('charity-insight-filters');
  const sourceButton=button(filters,'',()=>new Choice(context,[{path:'',label:'All sources'},...sources.map(source=>({path:source.path,label:source.name+' - '+source.path}))],path=>{state.sourcePath=path;update();},'Choose source').open());
  const areaButton=button(filters,'',()=>new Choice(context,[{path:'',label:'All areas'},...areas.map(area=>({path:area.path,label:area.label}))],path=>{state.areaPath=path;update();},'Choose area').open());
  for(const [key,label]of [['from','From visit date'],['to','To visit date']] as const) {
    const group=filters.createEl('label',{cls:'charity-insight-date'});group.createSpan({text:label});
    const input=group.createEl('input',{type:'date',attr:{'aria-label':label}});input.value=state[key]??'';
    input.onchange=()=>{state[key]=input.value;update();};
  }
  const search=filters.createEl('input',{type:'search',placeholder:'Search visits',attr:{'aria-label':'Search visits'}});search.value=state.query??'';
  search.oninput=()=>{state.query=search.value;update();};
  const warning=el.createDiv({attr:{role:'status','aria-live':'polite'}});
  for(const message of inspection.warnings)warning.createEl('p',{text:message,cls:'charity-error'});
  const result=el.createDiv('charity-insight-results');
  const update=()=>{
    if(!isCurrent())return;
    sourceButton.setText(state.sourcePath?'Source: '+name(state.sourcePath):'All sources');
    areaButton.setText(state.areaPath?'Area: '+(areas.find(area=>area.path===state.areaPath)?.label??'Missing area'):'All areas');
    result.empty();
    if(state.from&&state.to&&state.from>state.to){result.createEl('p',{text:'The end date must be on or after the start date.',cls:'charity-error'});return;}
    let records: VisitRecord[];
    try { records=filterVisitRecords(inspection.visits,places,areas,state); } catch(error) {result.createEl('p',{text:errorText(error),cls:'charity-error'});return;}
    result.createEl('p',{text:records.length+' recorded visits across '+new Set(records.map(row=>row.sourcePath)).size+' sources.',cls:'charity-hint'});
    if(!records.length){result.createEl('p',{text:'No structured visits match these filters. Older inline logs remain in their source notes; add reviewed visit details to include them here.',cls:'charity-empty-state'});return;}
    const weekdays=details(result,'Weekday comparisons');weekdays.open=true;
    weekdays.createEl('p',{text:'Fewer than five contributing visits is limited evidence. Different shop mixes, seasons and your subjective judgement can affect comparisons; this does not establish a best weekday.',cls:'charity-hint'});
    const weekdayTable=table(weekdays,['Weekday','Visits','Counts recorded','Average items','Visits buying','Scores recorded','Median haul']);
    for(const row of weekdayInsights(records)) {
      const line=weekdayTable.createEl('tr');
      for(const value of [row.label,String(row.visits),String(row.knownCounts)+(row.limitedCounts?' (limited)':''),row.meanItems===null?'Unknown':row.meanItems.toFixed(1),
        row.buyingPercentage===null?'Unknown':row.buyingPercentage.toFixed(0)+'%',String(row.scoreCount)+(row.limitedScores?' (limited)':''),row.medianScore===null?'Unknown':String(row.medianScore)])
        line.createEl('td',{text:value});
    }
    const history=details(result,'Visit records ('+records.length+')');history.open=true;
    const sorting=history.createDiv('charity-actions');
    for(const[key,label]of [['date','Newest visits'],['items','Most items'],['score','Highest haul score']] as const)button(sorting,label,()=>{state.sort=key;update();},state.sort===key||!state.sort&&key==='date');
    const sorted=[...records].sort((a,b)=> state.sort==='items'?(b.itemsPurchased??-1)-(a.itemsPurchased??-1)||b.visitDate.localeCompare(a.visitDate):
      state.sort==='score'?(b.haulPotential??-1)-(a.haulPotential??-1)||b.visitDate.localeCompare(a.visitDate):b.visitDate.localeCompare(a.visitDate)||b.recordedAt.localeCompare(a.recordedAt));
    const historyTable=table(history,['Visit date','Source','Items bought','Haul potential','New-stock colour','Actions']);
    for(const visit of sorted){
      const row=historyTable.createEl('tr');
      for(const value of [visit.visitDate,name(visit.sourcePath),visit.itemsPurchased===undefined?'Unknown':String(visit.itemsPurchased),
        visit.itemsPurchased===0?'Not applicable':visit.haulPotential===undefined?'Not recorded':visit.haulPotential+' / 5',visit.stockColour??'Not recorded']) row.createEl('td',{text:value});
      const actions=row.createEl('td',{cls:'charity-actions'});
      button(actions,'Open visit',()=>{const file=context.app.vault.getAbstractFileByPath(visit.path);if(!(file instanceof TFile))throw Error('This visit was removed. Refresh the list.');return context.openFile(visit.path);});
      button(actions,'Edit visit',()=>new StructuredVisitModal(context,visit.sourcePath,visit.path).open());
    }
    const colours=details(result,'Stock-colour observations');colours.open=state.coloursExpanded===true;
    colours.addEventListener('toggle',()=>{if(colours.isConnected)state.coloursExpanded=colours.open;});
    colours.createEl('p',{text:'One colour per shop visit. These are observations of presumed new-stock labels, not map-rating colours or a forecast of when fresh stock will appear.',cls:'charity-hint'});
    const toggle=colours.createEl('label',{cls:'charity-insight-toggle'}),checkbox=toggle.createEl('input',{type:'checkbox'});
    checkbox.checked=state.includeSuspected===true;checkbox.setAttribute('aria-label','Include suspected colour observations');
    toggle.createSpan({text:'Include suspected observations in possible repeats'});checkbox.onchange=()=>{state.includeSuspected=checkbox.checked;state.coloursExpanded=true;update();};
    const colourResult=colourInsights(records,state.includeSuspected);
    if(!colourResult.timeline.length)colours.createEl('p',{text:'No stock colours recorded.',cls:'charity-empty-state'});
    for(const sourcePath of [...new Set(colourResult.timeline.map(row=>row.sourcePath))]){
      const branch=details(colours,name(sourcePath));branch.open=!!state.sourcePath;
      const hints=colourResult.hints.filter(hint=>hint.sourcePath===sourcePath);
      if(!hints.length)branch.createEl('p',{text:'Not enough evidence for a possible repeat. Unchanged sightings, unknown meanings and a single return do not establish a cycle.',cls:'charity-hint'});
      for(const hint of hints){
        branch.createEl('strong',{text:hint.colour+': possible repeat'});
        branch.createEl('p',{text:hint.returns+' observed returns, '+hint.minimumDays+'-'+hint.maximumDays+' days between recorded runs (median '+hint.medianDays+').'+(hint.includesSuspected?' Includes suspected observations.':' Confirmed observations only.')});
        branch.createEl('p',{text:'Supporting dates: '+hint.supportingDates.join(', ')+'. Gaps between visits can hide changes; no future colour is predicted.',cls:'charity-hint'});
      }
      const conflicts=colourResult.conflictingDates.filter(row=>row.sourcePath===sourcePath);
      if(conflicts.length)branch.createEl('p',{text:'Conflicting colours on '+conflicts.map(row=>row.date).join(', ')+': excluded from repeat hints.',cls:'charity-error'});
      const rows=table(branch,['Visit date','Colour','Evidence','Use']);
      for(const observation of colourResult.timeline.filter(row=>row.sourcePath===sourcePath)){
        const row=rows.createEl('tr');for(const value of [observation.visitDate,observation.colour,observation.evidence,observation.conflicting?'Conflict':observation.eligible?'Included':'Timeline only'])row.createEl('td',{text:value});
      }
    }
  };
  update();
}
function table(parent:HTMLElement,headings:string[]):HTMLTableSectionElement{
  const scroll=parent.createDiv({cls:'charity-insight-table',attr:{tabindex:'0','aria-label':headings[0]+' table; scroll horizontally for more columns'}});
  const value=scroll.createEl('table'),head=value.createEl('thead').createEl('tr');for(const text of headings)head.createEl('th',{text,attr:{scope:'col'}});
  return value.createEl('tbody');
}
