/** Complete redistribution notices are injected by the shared desktop/mobile build. */
declare const __THIRD_PARTY_NOTICES__: string;

export const THIRD_PARTY_NOTICES: string = typeof __THIRD_PARTY_NOTICES__ === 'string'
  ? __THIRD_PARTY_NOTICES__
  : 'Complete third-party notices are included in packaged builds. Build this development checkout to read them here.';
