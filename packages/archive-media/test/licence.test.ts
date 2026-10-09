import { describe, expect, it } from "vitest";
import { licenceAllowed, licenceFromName, licenceFromUrl, licenceKind, unknownLicence } from "../src/licence.js";
import { creditLine, plainText } from "../src/text.js";

describe("licences", () => {
  it("reads Creative Commons URLs in their many spellings", () => {
    expect(licenceFromUrl("https://creativecommons.org/licenses/by-sa/4.0")?.id).toBe("CC-BY-SA-4.0");
    expect(licenceFromUrl("http://creativecommons.org/licenses/by/2.0/deed.it")?.id).toBe("CC-BY-2.0");
    expect(licenceFromUrl("https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode")?.id).toBe("CC-BY-NC-ND-4.0");
    expect(licenceFromUrl("https://creativecommons.org/publicdomain/zero/1.0/")).toMatchObject({ id: "CC0-1.0", attributionRequired: false });
    expect(licenceFromUrl("https://creativecommons.org/publicdomain/mark/1.0/")).toMatchObject({ id: "public-domain", basis: "PDM-1.0" });
    expect(licenceFromUrl("https://example.org/my-terms")).toBeNull();
    expect(licenceFromUrl("https://creativecommons.org/licenses/sampling+/1.0/")).toBeNull();
  });

  it("reads short names as providers write them", () => {
    expect(licenceFromName("CC BY-SA 4.0")?.id).toBe("CC-BY-SA-4.0");
    expect(licenceFromName("cc-by-sa-4.0")?.id).toBe("CC-BY-SA-4.0");
    expect(licenceFromName("by-nc-2.0")?.id).toBe("CC-BY-NC-2.0");
    expect(licenceFromName("CC0")?.id).toBe("CC0-1.0");
    expect(licenceFromName("pdm")).toMatchObject({ id: "public-domain", basis: "PDM-1.0" });
    expect(licenceFromName("PD-old-70")).toMatchObject({ id: "public-domain", basis: "PD-old-70" });
    expect(licenceFromName("All rights reserved")).toBeNull();
  });

  it("allows public domain, CC0, BY and BY-SA by default; never NC, ND or unknown", () => {
    const ok = (id: string) => licenceAllowed(licenceFromName(id)!).ok;
    expect([ok("pdm"), ok("CC0"), ok("CC BY 4.0"), ok("CC BY-SA 3.0")]).toEqual([true, true, true, true]);
    expect([ok("CC BY-NC 4.0"), ok("CC BY-ND 4.0"), ok("CC BY-NC-SA 4.0")]).toEqual([false, false, false]);
    expect(licenceAllowed(unknownLicence("none")).ok).toBe(false);
    expect(licenceAllowed(unknownLicence("x"), { allow: ["unknown"] }).ok).toBe(false);
    expect(licenceAllowed(licenceFromName("CC BY-NC 4.0")!, { allow: ["CC-BY-NC"] }).ok).toBe(true);
    expect(licenceKind(licenceFromName("CC BY-NC-SA 4.0")!)).toBe("CC-BY-NC-SA");
  });
});

describe("text", () => {
  it("turns Commons' HTML into a credit, dropping hidden machine data", () => {
    expect(plainText('1866<div style="display: none;">date QS:P571,+1866-00-00T00:00:00Z/9</div>')).toBe("1866");
    expect(plainText('<bdi><a href="x">Albert Bierstadt</a></bdi>')).toBe("Albert Bierstadt");
    expect(plainText("Mus&eacute;e &amp; co &#233;&#x41;")).toBe("Mus&eacute;e & co éA");
    expect(plainText("  ")).toBeUndefined();
    expect(creditLine({ title: "L'Orage", creator: "Kirstein", date: "1900", institution: "Wikimedia Commons", licence: "CC-BY-SA-4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/" }))
      .toBe("«L'Orage» by Kirstein (1900), Wikimedia Commons. CC-BY-SA-4.0, https://creativecommons.org/licenses/by-sa/4.0/");
  });
});
