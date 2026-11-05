import { defineConfig } from "vitepress";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// The sidebar is derived, not hand-maintained.
//
// Components come from compose.config.json — the same manifest the composer
// resolves — so the documentation cannot disagree with what is actually
// installable. ADRs are read from disk, so a new decision record appears
// without anyone remembering to register it.
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, "..", "..");
const DOCS = join(ROOT, "docs");
const config = JSON.parse(readFileSync(join(ROOT, "compose.config.json"), "utf-8"));

const components = Object.entries(config.components) as [string, any][];

function componentLinks(standalone: boolean) {
  return components
    .filter(([, c]) => c.standalone === standalone)
    .map(([name, c]) => ({
      text: name,
      link: `/${standalone ? "packages" : "studio"}/${name}`,
      // Capabilities are the useful thing to scan for, so surface them.
      ...(c.capabilities.length ? {} : {}),
    }));
}

/** ADRs, newest first — the recent decisions are the ones people look up. */
function adrLinks() {
  const dir = join(DOCS, "adr");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort()
    .reverse()
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      const number = slug.slice(0, 4);
      const title = slug
        .slice(5)
        .replace(/-/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
      return { text: `${number} — ${title}`, link: `/adr/${slug}` };
    });
}

export default defineConfig({
  title: "Agentic Video Studio",
  description:
    "A Pi-directed video production system. Reusable packages, a studio built on them, composed at install time.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,

  // docs/reference/ is synced from each component at build time; the copies
  // are build artifacts and are not tracked.
  ignoreDeadLinks: false,

  themeConfig: {
    nav: [
      { text: "Install", link: "/install" },
      { text: "Run", link: "/running" },
      { text: "Architecture", link: "/architecture" },
      { text: "Decisions", link: "/adr/" },
    ],

    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Overview", link: "/" },
          { text: "Install and composition", link: "/install" },
          { text: "Running the agent", link: "/running" },
          { text: "Repository layout", link: "/repository-layout" },
          { text: "Contributing", link: "/contributing" },
        ],
      },
      {
        text: "Understanding the system",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Harness review", link: "/harness-review" },
          { text: "Domain language", link: "/context" },
          { text: "Workspace layout", link: "/workspace" },
          { text: "Pipelines", link: "/pipelines" },
        ],
      },
      {
        text: "Editorial handoff",
        items: [{ text: "DaVinci Resolve", link: "/resolve-handoff" }],
      },
      {
        text: "Packages — reusable",
        collapsed: false,
        items: componentLinks(true),
      },
      {
        text: "Studio — the product",
        collapsed: false,
        items: componentLinks(false),
      },
      {
        text: "Decision records",
        collapsed: true,
        items: [{ text: "Index and status", link: "/adr/" }, ...adrLinks()],
      },
    ],

    outline: { level: [2, 3] },

    search: { provider: "local" },

    docFooter: { prev: true, next: true },
  },
});
