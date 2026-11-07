/**
 * The order line at the foot of the map. It is the command palette's front door: click it or type
 * Ctrl K or / anywhere. The prompt shows what the eye is watching, like a shell's working directory.
 */
export function openPalette() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
}

export function CommandLine({ context }: { context: string }) {
  return (
    <button
      type="button"
      onClick={openPalette}
      className="cmd-line liquid hx"
      aria-label="Give an order"
    >
      <span className="cmd-prompt">
        argus@<b>{context}</b>
        <span aria-hidden> ›</span>
      </span>
      <span className="cmd-hint">jump to a junction, send an ambulance, force rush hour…</span>
      <span className="cmd-caret" aria-hidden />
      <kbd className="cmd-kbd">Ctrl K</kbd>
    </button>
  );
}
