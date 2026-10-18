import { setWorkerUrl, clearPrewarmedResources } from 'maplibre-gl';

// Injected by esbuild after bundling the version-pinned ESM worker and its shared code.
declare const __MAP_WORKER_CODE__: string;
let workerUrl: string | undefined;

export function initializeMapRuntime(): void {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([__MAP_WORKER_CODE__],{type:'application/javascript'}));
    setWorkerUrl(workerUrl);
  }
}

export function shutdownMapRuntime(): void {
  clearPrewarmedResources();
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = undefined;
}
