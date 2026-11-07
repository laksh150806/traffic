import { useState, type ReactNode } from "react";

export type DossierFile = {
  id: string;
  label: string;
  /** One-line reading shown on the file's tab, e.g. "cycle 84 s". */
  tag?: string | undefined;
  render: () => ReactNode;
};

/**
 * The junction's evidence as a folder. Its files spring out of it and float as tabs; the one you
 * pick opens full width below and the rest stay docked. One file at a time keeps the column short
 * and the 3D and chart work to the file that is actually open.
 */
export function FolderFloat({
  title,
  files,
  initial,
}: {
  title: string;
  files: DossierFile[];
  initial?: string;
}) {
  const [open, setOpen] = useState(initial ?? files[0]?.id ?? "");
  const [fanned, setFanned] = useState(true);
  const current = files.find((f) => f.id === open) ?? files[0];

  return (
    <section className="dossier hx" aria-label={title}>
      <button
        type="button"
        className="folder-head"
        aria-expanded={fanned}
        onClick={() => setFanned((v) => !v)}
      >
        <svg viewBox="0 0 44 30" className="folder-glyph" aria-hidden>
          <path d="M1 5h14l4 4h24v20H1z" className="folder-back" />
          <path d="M1 12h42v17H1z" className={fanned ? "folder-front open" : "folder-front"} />
        </svg>
        <span className="folder-title">{title}</span>
        <span className="folder-count">{files.length} files</span>
      </button>

      <div
        className={fanned ? "file-cloud fanned" : "file-cloud"}
        role="tablist"
        aria-label="Files"
      >
        {files.map((f, i) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={f.id === current?.id}
            onClick={() => setOpen(f.id)}
            className="file-tab"
            style={{ ["--i" as string]: i, ["--n" as string]: files.length }}
          >
            <span className="file-name">{f.label}</span>
            {f.tag ? <span className="file-tag">{f.tag}</span> : null}
          </button>
        ))}
      </div>

      {current ? (
        <div key={current.id} role="tabpanel" className="file-sheet">
          {current.render()}
        </div>
      ) : null}
    </section>
  );
}
