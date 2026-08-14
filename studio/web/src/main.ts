import { mount } from "svelte";
import App from "./App.svelte";
import "./tokens/design-tokens.css";

const theme = resolveTheme();
const app = mount(App, {
  target: document.getElementById("app")!,
  props: { theme },
});

export default app;

function resolveTheme(): "light" | "dark" {
  const stored = localStorage.getItem("vs-theme");
  if (stored === "light" || stored === "dark") return stored;
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}
