import { validateRootPath } from '../domain';

/** The notebook's public Markdown layout, independent from workspace navigation. */
export class NotebookPaths {
  readonly root: string;
  constructor(root: string) { this.root = validateRootPath(root); }
  get places() { return this.root + '/Places'; }
  get visits() { return this.root + '/Visits'; }
  get outings() { return this.root + '/Outings'; }
  get inbox() { return this.root + '/Capture inbox'; }
  get system() { return this.root + '/System'; }
  get archives() { return this.system + '/Capture archive'; }
  get templates() { return this.system + '/Templates'; }
  get drafts() { return this.system + '/Preparation drafts'; }
  area(segments: readonly string[]) { return this.places + '/' + segments.join('/') + '/Area.md'; }
  place(segments: readonly string[], filename: string) { return this.places + '/' + (segments.length ? segments.join('/') : 'Unassigned') + '/' + filename + '.md'; }
  outing(name: string, date: string) { return this.outings + '/' + date.slice(0, 4) + '/' + date.slice(5, 7) + '/' + name + '.md'; }
}
