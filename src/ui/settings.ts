import { Notice, Platform, PluginSettingTab } from 'obsidian';
import type { App, Plugin, SettingDefinition, SettingDefinitionItem } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { Settings } from '../types';
import { validateRootPath } from '../domain';
import { distanceFromKm, distanceToKm, normaliseDistanceUnit } from '../units';
import { CLIPPER_TEMPLATE_RELEASE } from '../capture';
import { AreaHintsModal, CreditsModal, NotebookMoveModal, SetupModal, errorText } from '../ui';

type SettingsHost = NotebookContext & Plugin & { basesReady: boolean; examplesAvailable: boolean; showExamples(): void };

/** Definitions are pure: Obsidian also calls this method while indexing settings. */
export class SourcingSettings extends PluginSettingTab {
  private saves: Promise<void> = Promise.resolve();
  constructor(app: App, private plugin: SettingsHost) { super(app, plugin); }

  /** Serialize setting changes and restore the exact previous value on failure. */
  private persist<K extends keyof Settings>(key: K, value: Settings[K] | ((current: Settings[K]) => Settings[K]), restore: () => void, refresh = false): void {
    const save = this.saves.then(async () => {
      const finish = this.plugin.beginEditing();
      if (!finish) { restore(); return; }
      const previous = this.plugin.settings[key];
      try {
        this.plugin.settings[key] = typeof value === 'function' ? value(previous) : value;
        await this.plugin.saveSettings();
        if (refresh) this.update();
      } catch (error) {
        this.plugin.settings[key] = previous;
        restore();
        new Notice('Setting was not saved: ' + errorText(error));
      } finally { finish(); }
    });
    this.saves = save.catch(error => { new Notice(errorText(error)); });
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const plugin = this.plugin;
    const notebook: SettingDefinition[] = [
      { name: 'Open notebook', desc: plugin.settings.root, render: setting => {
        setting.addButton(control => control.setButtonText('Open notebook').setCta().onClick(() => { void plugin.home().catch(error => new Notice(errorText(error))); }));
      } },
      { name: 'Notebook folder', desc: 'Choose where the notebook lives inside this vault.', aliases: ['root', 'move'], render: setting => {
        if (plugin.settings.setupVersion) setting.addButton(control => control.setButtonText('Move notebook…').onClick(() => new NotebookMoveModal(plugin).open()));
        else setting.addText(control => {
          control.setValue(plugin.settings.root);
          control.inputEl.onchange = () => {
            const restore = () => { control.setValue(plugin.settings.root); };
            try { this.persist('root', validateRootPath(control.getValue()), restore); }
            catch (error) { restore(); new Notice(errorText(error)); }
          };
        });
      } },
      { name: 'Organisation recovery required', desc: 'Capture and editing are paused. Restore the previous organisation in Setup / help.', visible: () => plugin.store.migrationActive, render: setting => {
        setting.addButton(control => control.setButtonText('Recovery').onClick(() => new SetupModal(plugin).open()));
      } },
      { name: 'Fictional examples', desc: 'A separate practice notebook with 24 sources. Added only when you choose; deleted examples stay deleted.', render: setting => {
        setting.addButton(control => control.setButtonText(plugin.examplesAvailable ? 'Open examples' : 'Add examples').onClick(() => plugin.showExamples()));
      } },
    ];
    const defaults: SettingDefinition[] = [
      { name: 'Default source type', desc: 'Used when a new capture has no explicit type. Custom defaults are allowed; existing notes stay unchanged.', aliases: ['charity shop', 'capture'], render: setting => {
        const options = setting.controlEl.createEl('datalist', { attr: { id: 'sourcing-default-types-' + crypto.randomUUID() } });
        for (const value of new Set([...plugin.settings.sourceTypes, plugin.settings.defaultSourceType])) options.createEl('option', { value });
        setting.addText(control => {
          control.inputEl.setAttribute('list', options.id); control.inputEl.setAttribute('aria-label', 'Default source type');
          control.setValue(plugin.settings.defaultSourceType);
          control.inputEl.onchange = () => {
            const value = control.getValue().trim(), restore = () => { control.setValue(plugin.settings.defaultSourceType); };
            if (!value || value.length > 80 || /[\r\n]/.test(value)) { restore(); new Notice('Enter a source type of 1–80 characters.'); return; }
            this.persist('defaultSourceType', value, restore);
          };
        });
      } },
      { name: 'Source types', desc: 'One suggestion per line. A source can also use a custom type. Existing notes keep their type.', render: setting => {
        setting.addTextArea(control => {
          control.inputEl.rows = 5; control.inputEl.setAttribute('aria-label', 'Source types'); control.setValue(plugin.settings.sourceTypes.join('\n'));
          control.inputEl.onchange = () => {
            const values = [...new Set(control.getValue().split('\n').map(value => value.trim()).filter(Boolean))];
            const restore = () => { control.setValue(plugin.settings.sourceTypes.join('\n')); };
            if (!values.length || values.some(value => value.length > 80)) { restore(); new Notice('Keep at least one source type, with up to 80 characters per type.'); return; }
            this.persist('sourceTypes', values, restore);
          };
        });
      } },
      { name: 'Remembered address rules', desc: 'Review phrases and towns used to suggest localities. Edit, disable or remove any rule.', aliases: ['hints', 'town', 'locality'], render: setting => {
        setting.addButton(control => control.setButtonText('Manage address rules').onClick(() => new AreaHintsModal(plugin).open()));
      } },
      { name: 'Distance units', desc: 'Display miles or kilometres. Saved pins and calculations retain their precision.', render: setting => {
        setting.addDropdown(control => {
          control.selectEl.setAttribute('aria-label', 'Distance units');
          control.addOption('miles', 'Miles').addOption('km', 'Kilometres').setValue(normaliseDistanceUnit(plugin.settings.distanceUnit));
          control.onChange(value => this.persist('distanceUnit', normaliseDistanceUnit(value), () => { control.setValue(plugin.settings.distanceUnit); }, true));
        });
      } },
      { name: 'Nearby locality radius', desc: 'Suggest areas with a source or parking pin nearby. You always choose.', aliases: ['distance', 'miles', 'kilometres'], render: setting => {
        const unit = normaliseDistanceUnit(plugin.settings.distanceUnit);
        setting.setName('Nearby locality radius (' + unit + ')').addText(control => {
          const restore = () => { control.setValue(String(Number(distanceFromKm(plugin.settings.suggestionKm, unit).toFixed(3)))); };
          control.inputEl.type = 'number'; control.inputEl.step = 'any'; control.inputEl.min = String(distanceFromKm(.1, unit)); control.inputEl.max = String(distanceFromKm(50, unit)); control.inputEl.setAttribute('aria-label', 'Nearby locality radius'); restore();
          control.inputEl.onchange = () => {
            const raw = control.getValue().trim(), km = raw ? distanceToKm(Number(raw), unit) : NaN;
            if (!Number.isFinite(km) || km < .1 || km > 50) { restore(); new Notice('Use a radius from ' + distanceFromKm(.1, unit) + ' to ' + distanceFromKm(50, unit) + ' ' + unit + '.'); return; }
            this.persist('suggestionKm', km, restore);
          };
        });
      } },
    ];
    const backgrounds: SettingDefinition[] = plugin.settings.tileSets.flatMap(tile => {
      const saveTile = (key: 'name' | 'lightTiles' | 'darkTiles', value: string, restore: () => void) => {
        this.persist('tileSets', tiles => tiles.map(current => current.id === tile.id ? { ...current, [key]: value } : { ...current }), restore);
      };
      return ([['name', 'Name'], ['lightTiles', 'Light tiles'], ['darkTiles', 'Dark tiles']] as const).map(([key, label]): SettingDefinition => ({
        name: label + ' — ' + tile.name, desc: key === 'name' ? 'Custom map background' : 'Style URL or {z}/{x}/{y} raster URL.',
        render: setting => { setting.addText(control => {
          control.setValue(tile[key]); control.inputEl.onchange = () => saveTile(key, control.getValue().trim(), () => { control.setValue(plugin.settings.tileSets.find(value => value.id === tile.id)?.[key] ?? ''); });
        }); },
      })).concat({ name: 'Remove background — ' + tile.name, render: setting => {
        setting.addButton(control => control.setButtonText('Remove background').onClick(() => this.persist('tileSets', tiles => tiles.filter(value => value.id !== tile.id), () => this.update(), true)));
      } });
    });
    backgrounds.push({ name: 'Add custom background', desc: 'Free OpenFreeMap / OpenStreetMap is the default. Reopen maps after changing backgrounds.', render: setting => {
      setting.addButton(control => control.setButtonText('Add custom background').onClick(() => this.persist('tileSets', tiles => [...tiles, { id: crypto.randomUUID(), name: 'Custom', lightTiles: '', darkTiles: '' }], () => this.update(), true)));
    } });
    return [
      { type: 'group', heading: 'Notebook', items: notebook },
      { type: 'group', heading: 'Capture and travel defaults', items: defaults },
      { type: 'group', heading: 'Map backgrounds', items: backgrounds },
      { type: 'group', heading: 'Setup and information', items: [
        { name: 'Web Clipper templates', desc: Platform.isMobileApp ? 'Configure browser capture on desktop. Notes and manual entry work here.' : 'Available release v' + CLIPPER_TEMPLATE_RELEASE + '. Copy JSON, follow import steps and confirm each version.', render: setting => {
          setting.addButton(control => control.setButtonText(Platform.isMobileApp ? 'Desktop capture help' : 'Set up / update').onClick(() => plugin.openClipperSetup()));
        } },
        { name: 'Components and capture templates', desc: plugin.basesReady ? 'Core Bases is available. No other community plugin is required.' : 'Enable Bases in Settings → Core plugins, then reload this plugin.', render: setting => {
          setting.addButton(control => control.setButtonText('Setup / repair').onClick(() => new SetupModal(plugin).open()));
        } },
        { name: 'About and licences', desc: 'Version ' + plugin.manifest.version, render: setting => {
          setting.addButton(control => control.setButtonText('Credits').onClick(() => new CreditsModal(plugin).open()));
        } },
      ] },
    ];
  }
}
