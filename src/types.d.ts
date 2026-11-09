// Plugins de markdown-it sin tipos propios.
declare module "markdown-it-task-lists" {
  import type { PluginSimple, PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>;
  export default plugin;
}
declare module "markdown-it-footnote" {
  import type { PluginSimple, PluginWithOptions } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
declare module "markdown-it-emoji" {
  import type { PluginSimple, PluginWithOptions } from "markdown-it";
  export const full: PluginSimple;
}
declare module "@vscode/markdown-it-katex" {
  import type { PluginSimple, PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions<Record<string, unknown>>;
  export default plugin;
}
