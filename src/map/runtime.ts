import { getRTLTextPluginStatus, setRTLTextPlugin, setWorkerUrl, clearPrewarmedResources } from 'maplibre-gl';
import { rtlPluginCode } from './rtl-plugin-code';

// Injected by esbuild after bundling the version-pinned ESM worker and its shared code.
declare const __MAP_WORKER_CODE__: string;
let workerUrl: string | undefined;
let rtlInitialized = false;

export function initializeMapRuntime(): void {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([__MAP_WORKER_CODE__],{type:'application/javascript'}));
    setWorkerUrl(workerUrl);
  }
  if (!rtlInitialized && getRTLTextPluginStatus() === 'unavailable') {
    rtlInitialized = true;
    const url = URL.createObjectURL(new Blob([rtlPluginCode],{type:'application/javascript'}));
    void setRTLTextPlugin(url,false).catch(error => console.warn('Optional RTL map text could not initialize:',error)).finally(() => URL.revokeObjectURL(url));
  }
}

export function shutdownMapRuntime(): void {
  clearPrewarmedResources();
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = undefined;
}
