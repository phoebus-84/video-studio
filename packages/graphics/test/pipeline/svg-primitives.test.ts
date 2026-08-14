import { describe, it, expect } from "vitest";
import { renderSvg, text, rect, line, group, vstack, titleCardLayout, quoteCardLayout } from "../../src/pipeline/svg-primitives.js";
import type { SvgDocument } from "../../src/pipeline/svg-primitives.js";

describe("SVG primitives", () => {
  describe("text", () => {
    it("creates a text element", () => {
      const el = text(100, 200, "Hello");
      expect(el.tag).toBe("text");
      expect(el.attrs.x).toBe("100");
      expect(el.attrs["font-size"]).toBe("24px");
      expect(el.attrs.fill).toBe("#e0e0e0");
    });

    it("accepts custom style", () => {
      const el = text(50, 50, "Title", { fontSize: 48, fontWeight: "bold", fill: "#ff6b35", textAnchor: "middle" });
      expect(el.attrs["font-size"]).toBe("48px");
      expect(el.attrs["font-weight"]).toBe("bold");
      expect(el.attrs.fill).toBe("#ff6b35");
      expect(el.attrs["text-anchor"]).toBe("middle");
    });
  });

  describe("rect", () => {
    it("creates a rect with rounded corners", () => {
      const el = rect(10, 20, 100, 50, "#333", "#666", 8);
      expect(el.tag).toBe("rect");
      expect(el.attrs.rx).toBe("8");
    });
  });

  describe("line", () => {
    it("creates a line", () => {
      const el = line(0, 0, 100, 100, "#f00", 2);
      expect(el.tag).toBe("line");
      expect(el.attrs.stroke).toBe("#f00");
      expect(el.attrs["stroke-width"]).toBe("2");
    });
  });

  describe("group", () => {
    it("wraps children", () => {
      const el = group([text(0, 0, "A"), text(0, 20, "B")], { id: "g1" });
      expect(el.tag).toBe("g");
      expect(el.children!.length).toBe(2);
    });
  });

  describe("renderSvg", () => {
    it("renders complete SVG", () => {
      const doc: SvgDocument = { width: 1920, height: 1080, elements: [text(50, 50, "Test")] };
      const svg = renderSvg(doc);
      expect(svg).toContain('<?xml version="1.0"');
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain(">Test<");
      expect(svg).toContain("</svg>");
    });

    it("is deterministic", () => {
      const doc: SvgDocument = { width: 100, height: 100, elements: [rect(0, 0, 100, 100, "#000")] };
      expect(renderSvg(doc)).toBe(renderSvg(doc));
    });

    it("renders nested groups", () => {
      const doc: SvgDocument = { width: 200, height: 100, elements: [group([rect(10, 10, 180, 80, "#222"), text(100, 50, "Inside")])] };
      const svg = renderSvg(doc);
      
      expect(svg).toContain("<rect");
      
    });
  });

  describe("titleCardLayout", () => {
    it("renders title and subtitle", () => {
      const doc = titleCardLayout({ width: 1920, height: 1080, title: "My Video", subtitle: "Chapter One" });
      const svg = renderSvg(doc);
      expect(svg).toContain("My Video");
      expect(svg).toContain("Chapter One");
    });
  });

  describe("quoteCardLayout", () => {
    it("renders quote with attribution", () => {
      const doc = quoteCardLayout({ width: 1920, height: 1080, quote: "Less is more.", attribution: "Mies van der Rohe" });
      const svg = renderSvg(doc);
      expect(svg).toContain("Less is more.");
      expect(svg).toContain("Mies van der Rohe");
    });

    it("renders quote alone", () => {
      const doc = quoteCardLayout({ width: 1920, height: 1080, quote: "Just the quote" });
      const svg = renderSvg(doc);
      expect(svg).toContain("Just the quote");
      expect(svg).not.toContain("\u2014"); // no em-dash when no attribution
    });
  });

  describe("vstack", () => {
    it("stacks text elements vertically", () => {
      const els = vstack(
        [text(0, 0, "Line 1"), text(0, 0, "Line 2")],
        { x: 100, y: 100, width: 300, height: 200 },
        { padding: 10, gap: 8 },
      );
      expect(els.length).toBe(2);
      expect(els[0]!.attrs.y).toBe("110"); // 100 + padding 10
      expect(els[1]!.attrs.y).toBe("142"); // 100 + 10 + 24px text + 8 gap
    });
  });
});
