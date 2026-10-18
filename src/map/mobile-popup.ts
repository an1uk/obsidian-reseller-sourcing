/** A map-owned touch popup does not inherit MapLibre's pin-relative transforms. */
export class MobileMapPopup {
  private overlay: HTMLElement | null = null;
  private restoreFocus: (() => void) | null = null;

  constructor(private container: HTMLElement) {}

  open(content: HTMLElement, label: string, trigger?: HTMLElement): void {
    this.close(false);
    const active = trigger ?? this.container.ownerDocument.activeElement;
    if (active?.instanceOf(HTMLElement)) {
      this.restoreFocus = () => { if (active.isConnected) active.focus(); };
    }
    const overlay = this.overlay = this.container.createDiv({
      cls: 'charity-map-touch-popup',
      attr: { role: 'dialog', 'aria-label': label, 'aria-modal': 'false' }
    });
    const close = overlay.createEl('button', {
      text: 'Close', cls: 'charity-map-touch-popup-close', attr: { 'aria-label': 'Close place details' }
    });
    close.addEventListener('click', () => this.close());
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    });
    // Keep scrolling and actions inside the sheet from becoming map gestures.
    for (const event of ['click', 'dblclick', 'pointerdown', 'touchstart', 'wheel']) {
      overlay.addEventListener(event, event => event.stopPropagation());
    }
    overlay.appendChild(content);
    close.focus();
  }

  close(restore = true): void {
    this.overlay?.remove();
    this.overlay = null;
    const focus = this.restoreFocus;
    this.restoreFocus = null;
    if (restore) focus?.();
  }

  destroy(): void { this.close(false); }
}
