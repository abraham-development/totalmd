// Utilidades de rutas POSIX (la app corre en Linux).

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  return i === 0 ? "/" : p.slice(0, i);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function extname(p: string): string {
  const base = basename(p);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}

export function normalize(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
    } else out.push(part);
  }
  return (abs ? "/" : "") + out.join("/");
}

/** Resuelve `rel` respecto a la carpeta `base`. */
export function resolve(base: string, rel: string): string {
  return normalize(rel.startsWith("/") ? rel : `${base}/${rel}`);
}

export function isMermaidFile(p: string): boolean {
  return [".mmd", ".mermaid"].includes(extname(p));
}

export function isDocFile(p: string): boolean {
  return [".md", ".markdown", ".mdown", ".mkd", ".mmd", ".mermaid"].includes(extname(p));
}

/** Una ruta de enlace es externa si lleva esquema (http:, mailto:, ...). */
export function hasScheme(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
