import type { VisitRecord } from './types';

/** Date-only calculations avoid device timezone and daylight-saving changes. */
const serialDay = (date: string): number => Date.parse(date + 'T00:00:00Z') / 86_400_000;
const normalColour = (value: string): string => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export interface WeekdaySummary {
  day: number; label: string; visits: number; knownCounts: number; itemsTotal: number;
  meanItems: number | null; buyingPercentage: number | null; scoreCount: number; medianScore: number | null;
  limitedCounts: boolean; limitedScores: boolean;
}
export function weekdayInsights(visits: readonly VisitRecord[]): WeekdaySummary[] {
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, day) => {
    const rows = visits.filter(v => (new Date(v.visitDate + 'T00:00Z').getUTCDay() + 6) % 7 === day);
    const counted = rows.filter(v => typeof v.itemsPurchased === 'number' && Number.isSafeInteger(v.itemsPurchased) && v.itemsPurchased >= 0);
    const scores = rows.filter(v => v.itemsPurchased !== 0 && typeof v.haulPotential === 'number' && Number.isInteger(v.haulPotential) && v.haulPotential >= 1 && v.haulPotential <= 5).map(v => v.haulPotential!);
    const itemsTotal = counted.reduce((n, v) => n + v.itemsPurchased!, 0);
    return { day, label, visits: rows.length, knownCounts: counted.length, itemsTotal,
      meanItems: counted.length ? itemsTotal / counted.length : null,
      buyingPercentage: counted.length ? counted.filter(v => v.itemsPurchased! > 0).length / counted.length * 100 : null,
      scoreCount: scores.length, medianScore: median(scores), limitedCounts: counted.length < 5, limitedScores: scores.length < 5 };
  });
}
export interface ColourObservation {
  sourcePath: string; visitPath: string; visitDate: string; colour: string;
  evidence: string; conflicting: boolean; eligible: boolean;
}
export interface ColourHint {
  sourcePath: string; colour: string; returns: number; minimumDays: number; maximumDays: number;
  medianDays: number; supportingDates: string[]; includesSuspected: boolean;
}
export interface ColourInsights {
  timeline: ColourObservation[]; conflictingDates: { sourcePath: string; date: string }[]; hints: ColourHint[];
}
/** Observed gaps are not a stock timetable or a prediction of future colours. */
export function colourInsights(visits: readonly VisitRecord[], includeSuspected = false): ColourInsights {
  const timeline: ColourObservation[] = [], conflictingDates: ColourInsights['conflictingDates'] = [], hints: ColourHint[] = [];
  const sources = [...new Set(visits.map(v => v.sourcePath))].sort();
  for (const sourcePath of sources) {
    const rows = visits.filter(v => v.sourcePath === sourcePath && v.stockColour?.trim())
      .sort((a, b) => a.visitDate.localeCompare(b.visitDate) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
    const days = [...new Set(rows.map(v => v.visitDate))], sequence: { date: string; colour: string; label: string; suspected: boolean }[] = [];
    for (const date of days) {
      const sameDay = rows.filter(v => v.visitDate === date);
      const conflict = new Set(sameDay.map(v => normalColour(v.stockColour!))).size > 1;
      if (conflict) conflictingDates.push({ sourcePath, date });
      const eligible = sameDay.filter(v => v.colourEvidence === 'confirmed' || includeSuspected && v.colourEvidence === 'suspected');
      for (const visit of sameDay) timeline.push({ sourcePath, visitPath: visit.path, visitDate: date, colour: visit.stockColour!.trim(),
        evidence: visit.colourEvidence ?? 'unknown', conflicting: conflict, eligible: !conflict && eligible.includes(visit) });
      if (conflict || !eligible.length) continue;
      const representative = eligible.find(v => v.colourEvidence === 'confirmed') ?? eligible[0];
      const colour = normalColour(representative.stockColour!);
      if (sequence.at(-1)?.colour === colour) continue; // Unchanged sightings are one observed run.
      sequence.push({ date, colour, label: representative.stockColour!.trim(), suspected: representative.colourEvidence !== 'confirmed' });
    }
    for (const colour of [...new Set(sequence.map(row => row.colour))]) {
      const occurrences = sequence.filter(row => row.colour === colour);
      if (occurrences.length < 3) continue; // Two returns, each with another colour between.
      const gaps = occurrences.slice(1).map((row, i) => serialDay(row.date) - serialDay(occurrences[i].date));
      if (gaps.some(gap => !Number.isFinite(gap) || gap <= 0)) continue;
      hints.push({ sourcePath, colour: occurrences[0].label, returns: gaps.length,
        minimumDays: Math.min(...gaps), maximumDays: Math.max(...gaps), medianDays: median(gaps)!,
        supportingDates: occurrences.map(row => row.date), includesSuspected: sequence.some(row => row.suspected) });
    }
  }
  return { timeline, conflictingDates, hints };
}

export interface VisitFilter { sourcePath?: string; areaPath?: string; from?: string; to?: string; query?: string; }
export function filterVisitRecords(visits: readonly VisitRecord[], places: readonly import('../types').PlaceRecord[], areas: readonly import('../types').LocalityRecord[], filter: VisitFilter): VisitRecord[] {
  for (const [label,value] of [['start',filter.from],['end',filter.to]] as const) {
    if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00Z'))||new Date(value+'T00:00Z').toISOString().slice(0,10)!==value))throw Error('Choose a valid '+label+' visit date.');
  }
  if(filter.from&&filter.to&&filter.from>filter.to)throw Error('The end date must be on or after the start date.');
  const byPath=new Map(places.map(place=>[place.path,place])),selectedArea=areas.find(area=>area.path===filter.areaPath),query=(filter.query??'').trim().toLocaleLowerCase();
  return visits.filter(visit=>{
    const source=byPath.get(visit.sourcePath),area=areas.find(a=>a.path===source?.locality);
    const sameArea=!filter.areaPath||area?.path===filter.areaPath||!!selectedArea&&!!area&&area.segments.slice(0,selectedArea.segments.length).join('/')===selectedArea.segments.join('/');
    return (!filter.sourcePath||visit.sourcePath===filter.sourcePath)&&sameArea&&(!filter.from||visit.visitDate>=filter.from)&&(!filter.to||visit.visitDate<=filter.to)&&
      (!query||[source?.name,visit.sourcePath,source?.properties.town,source?.properties.address,visit.observations,visit.finds,visit.nextTime,visit.stockColour].join(' ').toLocaleLowerCase().includes(query));
  });
}
