/** Native event handlers report rejected notebook actions without leaking a promise. */
export function runMapAction(action: () => unknown, report: (error: unknown) => void = error => console.warn('Map action unavailable:', error)): void {
  try { void Promise.resolve(action()).catch(report); }
  catch (error) { report(error); }
}
