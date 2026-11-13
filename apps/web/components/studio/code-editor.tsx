"use client";

import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

const LANG = { "spirit.json": json, "index.html": html, "app.js": javascript, "style.css": css } as const;
export type EditorFile = keyof typeof LANG;

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "#050a07" },
  ".cm-scroller": { fontFamily: "var(--font-geist-mono, ui-monospace), monospace" },
  ".cm-gutters": { backgroundColor: "#050a07", borderRight: "1px solid #1f3a2b" },
});

/** CodeMirror 6. Remount with a new `key` to switch files. */
export function CodeEditor({ file, value, onChange }: { file: EditorFile; value: string; onChange: (v: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  const initial = useRef(value);

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      doc: initial.current,
      parent: host.current,
      extensions: [
        basicSetup,
        LANG[file](),
        oneDark,
        theme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) change.current(u.state.doc.toString());
        }),
      ],
    });
    return () => view.destroy();
  }, [file]);

  return <div ref={host} className="h-full overflow-hidden rounded-lg border border-border" />;
}
