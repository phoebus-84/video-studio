const REQUIRED_PRODUCT_SECTIONS = [
  "Register",
  "Users",
  "Product Purpose",
  "Brand Personality",
  "Anti-references",
  "Design Principles",
  "Accessibility & Inclusion",
];

const REQUIRED_DESIGN_SECTIONS = [
  "Overview",
  "Colors",
  "Typography",
  "Elevation",
  "Components",
  "Do's and Don'ts",
];

const REQUIRED_BRIEF_SECTIONS = [
  "Feature Summary",
  "Primary User Action",
  "Design Direction",
  "Scope",
  "Layout Strategy",
  "Key States",
  "Interaction Model",
  "Content Requirements",
  "Recommended References",
  "Open Questions",
];

const REQUIRED_JOURNEYS = [
  ["autopilot", "BRIEF_JOURNEY_AUTOPILOT_MISSING"],
  ["artifact", "BRIEF_JOURNEY_ARTIFACT_MISSING"],
  ["asset", "BRIEF_JOURNEY_ASSET_MISSING"],
  ["anchor", "BRIEF_JOURNEY_ANCHORED_REVIEW_MISSING"],
  ["rerun", "BRIEF_JOURNEY_RERUN_MISSING"],
  ["block", "BRIEF_JOURNEY_BLOCKER_MISSING"],
];

function diagnostic(code, file, message) {
  return { code, file, message };
}

function headings(markdown) {
  return [...markdown.matchAll(/^##\s+(?:\d+\.\s+)?(.+)$/gm)].map((match) =>
    match[1].trim(),
  );
}

function validateSections(markdown, required, file, codePrefix) {
  const found = headings(markdown);
  const diagnostics = [];

  for (const section of required) {
    if (!found.includes(section)) {
      diagnostics.push(
        diagnostic(
          `${codePrefix}_SECTION_MISSING`,
          file,
          `Required section is missing: ${section}`,
        ),
      );
    }
  }

  const positions = required.map((section) => found.indexOf(section));
  const presentPositions = positions.filter((position) => position >= 0);
  if (
    presentPositions.some(
      (position, index) => index > 0 && position < presentPositions[index - 1],
    )
  ) {
    diagnostics.push(
      diagnostic(
        `${codePrefix}_SECTION_ORDER_INVALID`,
        file,
        "Required sections are not in canonical order.",
      ),
    );
  }

  return diagnostics;
}

export function validateDesignContext({ product, design, brief }) {
  const documents = [
    ["PRODUCT.md", product],
    ["DESIGN.md", design],
    ["docs/SHAPE-BRIEF.md", brief],
  ];
  const diagnostics = [];

  for (const [file, content] of documents) {
    if (/\b(?:TODO|TBD|FIXME|PLACEHOLDER)\b|\[TODO\]/i.test(content)) {
      diagnostics.push(
        diagnostic(
          "CONTEXT_PLACEHOLDER_FOUND",
          file,
          "Product and design context must not contain placeholder markers.",
        ),
      );
    }
  }

  diagnostics.push(
    ...validateSections(
      product,
      REQUIRED_PRODUCT_SECTIONS,
      "PRODUCT.md",
      "PRODUCT",
    ),
    ...validateSections(
      design,
      REQUIRED_DESIGN_SECTIONS,
      "DESIGN.md",
      "DESIGN",
    ),
    ...validateSections(
      brief,
      REQUIRED_BRIEF_SECTIONS,
      "docs/SHAPE-BRIEF.md",
      "BRIEF",
    ),
  );

  if (!/^## Register\s+product\s*$/m.test(product)) {
    diagnostics.push(
      diagnostic(
        "PRODUCT_REGISTER_INVALID",
        "PRODUCT.md",
        'Register must be the bare value "product".',
      ),
    );
  }

  if (!/^Status:\s*Approved\s*$/m.test(brief)) {
    diagnostics.push(
      diagnostic(
        "BRIEF_NOT_APPROVED",
        "docs/SHAPE-BRIEF.md",
        "The shape brief requires explicit approval before scaffolding.",
      ),
    );
  }

  if (!/Visual probe:[\s\S]*Skipped because/i.test(brief)) {
    diagnostics.push(
      diagnostic(
        "IMAGE_GATE_UNRESOLVED",
        "docs/SHAPE-BRIEF.md",
        "The visual-probe decision and reason must be recorded.",
      ),
    );
  }

  for (const [term, code] of REQUIRED_JOURNEYS) {
    if (!brief.toLowerCase().includes(term)) {
      diagnostics.push(
        diagnostic(
          code,
          "docs/SHAPE-BRIEF.md",
          `Required journey is not represented: ${term}`,
        ),
      );
    }
  }

  return diagnostics;
}
