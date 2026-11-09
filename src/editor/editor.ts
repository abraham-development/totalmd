// Editor CodeMirror 6. Una sola vista; cada pestaña guarda su propio EditorState.
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars } from "@codemirror/view";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { tags as t } from "@lezer/highlight";

const themeCompartment = new Compartment();
let darkMode = false;

export interface EditorCallbacks {
  onChange: (state: EditorState) => void;
  onCursor: (state: EditorState) => void;
  onScroll: () => void;
}

let view: EditorView;
let callbacks: EditorCallbacks;

const lightTheme = EditorView.theme({
  "&": { backgroundColor: "var(--bg)", color: "var(--fg)" },
  ".cm-gutters": { backgroundColor: "var(--bg-alt)", color: "var(--fg-muted)", borderRight: "1px solid var(--border)" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--active-line)" },
});

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "calc(14px * var(--zoom, 1))" },
  ".cm-scroller": { fontFamily: "'Ubuntu Mono', 'JetBrains Mono', 'DejaVu Sans Mono', monospace", lineHeight: "1.55" },
  ".cm-content": { padding: "12px 0 40vh" },
  "&.cm-focused": { outline: "none" },
});

// Resaltado claro sobrio: sin subrayados (el estilo por defecto subraya títulos y enlaces).
const lightHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700", color: "#0550ae" },
  { tag: [t.heading1, t.heading2], fontWeight: "700", color: "#0550ae" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "#0969da" },
  { tag: t.monospace, color: "#953800" },
  { tag: t.quote, color: "#57606a", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.contentSeparator, t.list], color: "#8250df" },
  { tag: t.meta, color: "#6e7781" },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "#cf222e" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#0a3069" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#0550ae" },
  { tag: t.comment, color: "#6e7781", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#8250df" },
  { tag: [t.typeName, t.className, t.namespace], color: "#953800" },
  { tag: [t.propertyName, t.attributeName], color: "#116329" },
  { tag: t.invalid, color: "#cf222e" },
]);

function themeExtension(): Extension {
  return darkMode ? oneDark : [lightTheme, syntaxHighlighting(lightHighlight, { fallback: true })];
}

function extensions(isMermaid: boolean): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    EditorView.lineWrapping,
    baseTheme,
    themeCompartment.of(themeExtension()),
    isMermaid ? [] : markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) callbacks.onChange(u.state);
      if (u.docChanged || u.selectionSet) callbacks.onCursor(u.state);
    }),
  ];
}

export function initEditor(parent: HTMLElement, cb: EditorCallbacks): EditorView {
  callbacks = cb;
  view = new EditorView({ state: createState("", false), parent });
  view.scrollDOM.addEventListener("scroll", () => callbacks.onScroll(), { passive: true });
  return view;
}

export function createState(doc: string, isMermaid: boolean): EditorState {
  return EditorState.create({ doc, extensions: extensions(isMermaid) });
}

export function getView(): EditorView {
  return view;
}

/** Cambia el estado mostrado (al cambiar de pestaña) y reaplica el tema actual. */
export function showState(state: EditorState, scrollTop = 0): void {
  view.setState(state);
  view.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) });
  requestAnimationFrame(() => (view.scrollDOM.scrollTop = scrollTop));
}

export function setEditorDark(dark: boolean): void {
  darkMode = dark;
  if (view) view.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) });
}

/** Reemplaza todo el contenido conservando cursor y scroll lo mejor posible. */
export function replaceContent(state: EditorState, text: string): EditorState {
  const tr = state.update({
    changes: { from: 0, to: state.doc.length, insert: text },
    selection: { anchor: Math.min(state.selection.main.head, text.length) },
  });
  return tr.state;
}

/** Línea (base 0) visible en la parte superior del editor, con fracción. */
export function topVisibleLine(): number {
  // Las alturas de bloque se miden desde el inicio del documento, igual que scrollTop.
  const top = view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(top);
  const line = view.state.doc.lineAt(block.from).number - 1;
  const frac = block.height > 0 ? (top - block.top) / block.height : 0;
  return line + Math.max(0, Math.min(1, frac));
}

/** Desplaza el editor para que la línea (base 0, con fracción) quede arriba. */
export function scrollToLine(line: number): void {
  const doc = view.state.doc;
  const n = Math.max(1, Math.min(doc.lines, Math.floor(line) + 1));
  const block = view.lineBlockAt(doc.line(n).from);
  view.scrollDOM.scrollTop = block.top + block.height * (line - Math.floor(line));
}
