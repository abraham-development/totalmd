// Markdown → HTML saneado, con marcas de línea de origen para sincronizar el scroll.
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import frontMatter from "markdown-it-front-matter";
import { full as emoji } from "markdown-it-emoji";
import katex from "@vscode/markdown-it-katex";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import { fileUrl } from "../api";
import { dirname, hasScheme, resolve, safeDecode } from "../path";

/** Algunos plugins son CommonJS y su `default` puede llegar envuelto según el empaquetador. */
function plugin<T>(mod: T): T {
  const m = mod as unknown as { default?: T };
  return typeof mod === "function" ? mod : (m.default ?? mod);
}

const MERMAID_LANGS = new Set(["mermaid", "mmd"]);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Slugs compatibles con GitHub, también para acentos y ñ. */
export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* cae al escape por defecto */
      }
    }
    return "";
  },
})
  .use(plugin(frontMatter), () => {})
  .use(plugin(anchor), { slugify, tabIndex: false })
  .use(plugin(taskLists), { enabled: true, label: true })
  .use(plugin(footnote))
  .use(plugin(emoji))
  .use(plugin(katex), { throwOnError: false, enableMathBlockInHtml: true, enableMathInlineInHtml: true });

// Cada bloque recibe data-line con su línea de origen (base 0).
md.core.ruler.push("source_lines", (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0 && token.type !== "inline") {
      token.attrSet("data-line", String(token.map[0]));
    }
  }
});

const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (MERMAID_LANGS.has(lang)) {
    // El código va aparte (env), no en un atributo: DOMPurify borra atributos con "-->".
    const line = token.map ? token.map[0] : 0;
    const sources = ((env as { mermaid?: string[] }).mermaid ??= []);
    sources.push(token.content);
    return `<div class="mermaid-block" data-line="${line}" data-mi="${sources.length - 1}"></div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

md.renderer.rules.front_matter = (tokens, idx) => {
  const t = tokens[idx];
  return `<details class="front-matter" data-line="${t.map?.[0] ?? 0}"><summary>Metadatos</summary><pre><code>${escapeHtml(String(t.meta ?? ""))}</code></pre></details>\n`;
};

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  // Los checkbox de tareas deben seguir siendo clicables.
  if (data.attrName === "disabled") data.keepAttr = false;
});

export interface RenderResult {
  fragment: DocumentFragment;
  mermaidCount: number;
}

/** Renderiza un documento .md (o un .mmd completo) a un fragmento DOM listo para insertar. */
export function renderDocument(source: string, docPath: string | null, isMermaid: boolean): RenderResult {
  const env: { mermaid?: string[] } = {};
  const html = isMermaid
    ? `<div class="mermaid-block mermaid-full" data-line="0" data-mi="0"></div>`
    : md.render(source, env);
  const sources = isMermaid ? [source] : (env.mermaid ?? []);

  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ADD_ATTR: ["target"],
    ADD_TAGS: ["details", "summary"],
  }) as DocumentFragment;

  for (const block of fragment.querySelectorAll<HTMLElement>(".mermaid-block[data-mi]")) {
    block.dataset.src = sources[Number(block.dataset.mi)] ?? "";
    block.removeAttribute("data-mi");
  }

  const baseDir = docPath ? dirname(docPath) : null;
  for (const img of fragment.querySelectorAll<HTMLImageElement>("img[src]")) {
    const src = img.getAttribute("src")!;
    img.loading = "lazy";
    if (baseDir && !hasScheme(src) && !src.startsWith("//")) {
      img.dataset.origSrc = src;
      img.src = fileUrl(resolve(baseDir, safeDecode(src.split(/[?#]/)[0])));
    }
  }
  // Cabecera con el lenguaje y botón «Copiar», fuera del <pre> para que no se desplace con el scroll horizontal.
  for (const pre of fragment.querySelectorAll("pre")) {
    if (pre.closest(".front-matter")) continue;
    const wrap = document.createElement("div");
    wrap.className = "code-wrap";
    const head = document.createElement("div");
    head.className = "code-head";
    const lang = document.createElement("span");
    lang.className = "code-lang";
    lang.textContent = /\blanguage-(\S+)/.exec(pre.querySelector("code")?.className ?? "")?.[1] ?? "";
    const copy = document.createElement("button");
    copy.className = "code-copy";
    copy.dataset.action = "code-copy";
    copy.title = "Copiar el bloque de código";
    copy.textContent = "Copiar";
    head.append(lang, copy);
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  }

  for (const table of fragment.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }

  return { fragment, mermaidCount: fragment.querySelectorAll(".mermaid-block").length };
}

/** Cuenta palabras sin recorrer el documento varias veces. */
export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}
