import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedInsightsState } from '../src/ui/insights-state';
const element = (pane: object) => ({ closest: () => pane }) as unknown as HTMLElement;
test('embedded insight filters survive replacement of the Markdown child in one pane', () => {
  const pane = {}, first = embeddedInsightsState(element(pane), 'Notebook/Visits.md');
  first.from = '2026-10-01'; first.query = 'denim'; first.coloursExpanded = true;
  assert.equal(embeddedInsightsState(element(pane), 'Notebook/Visits.md'), first);
  assert.equal(embeddedInsightsState(element(pane), 'Notebook/Visits.md').from, '2026-10-01');
});
test('insight view state stays separate between panes and real and example paths', () => {
  const pane = {}, other = {}, a = embeddedInsightsState(element(pane), 'Notebook/Visits.md');
  a.sourcePath = 'Notebook/Sources/A.md';
  assert.deepEqual(embeddedInsightsState(element(other), 'Notebook/Visits.md'), {});
  assert.deepEqual(embeddedInsightsState(element(pane), 'Notebook/Examples/Visits.md'), {});
});
