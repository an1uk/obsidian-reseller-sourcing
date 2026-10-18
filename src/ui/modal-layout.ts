import type { Modal } from 'obsidian';

/** Scope keyboard-aware layouts to our modal's container rather than ancestor selectors. */
export function markInputModal(modal: Modal): void {
  modal.containerEl.addClass('charity-input-modal-container');
}

export function modalWindow(modal: Modal): Window {
  return modal.contentEl.ownerDocument?.defaultView ?? window;
}
