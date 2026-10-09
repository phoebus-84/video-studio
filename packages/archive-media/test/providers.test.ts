import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aic, cleveland, commons, internetArchive, met, nasa, openverse } from "../src/providers/index.js";
import { originalOf } from "../src/providers/nasa.js";
import type { Http } from "../src/types.js";

/** Answers each URL from a recorded response, by the first pattern it matches; records what was asked. */
function recorded(routes: [RegExp, string][]): Http & { asked: { url: string; headers?: Record<string, string> }[] } {
  const asked: { url: string; headers?: Record<string, string> }[] = [];
  return {
    userAgent: "test-agent (test@example.invalid)",
    asked,
    async json(url, options) {
      asked.push({ url, ...(options?.headers ? { headers: options.headers } : {}) });
      const hit = routes.find(([pattern]) => pattern.test(url));
      if (!hit) throw new Error(`no recorded response for ${url}`);
      return JSON.parse(readFileSync(join(__dirname, "fixtures", hit[1]), "utf-8"));
    },
  };
}

const opts = (mediaType: "image" | "audio" | "video" = "image", limit = 3) => ({ mediaType, limit });

describe("Wikimedia Commons", () => {
  it("finds originals with their licence from extmetadata", async () => {
    const http = recorded([[/generator=search/, "commons-search.json"]]);
    const items = await commons.search("storm painting", opts(), http);
    expect(decodeURIComponent(http.asked[0]!.url)).toContain("gsrsearch=storm+painting+filetype:bitmap");
    const first = items[0]!;
    expect(first).toMatchObject({
      provider: "commons",
      id: "File:Albert Bierstadt - A Storm in the Rocky Mountains, Mt. Rosalie - Google Art Project.jpg",
      mediaType: "image", creator: "Albert Bierstadt", date: "1866", width: 5736, height: 3319, mime: "image/jpeg",
      licence: { id: "public-domain", attributionRequired: false },
    });
    expect(first.fileUrl).toMatch(/^https:\/\/upload\.wikimedia\.org\/.+\.jpg$/);
    expect(first.landingUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    expect(first.licence.basis).toBe("commons: Public domain");
    // Its Credit is the digitization ("Google Art Project"), not the museum.
    expect(first.institution).toBeUndefined();
  });

  it("reads a sound's CC BY-SA licence and its credit", async () => {
    const http = recorded([[/generator=search/, "commons-audio-search.json"]]);
    const thunder = (await commons.search("thunder", opts("audio"), http)).find((i) => i.id === "File:Thunder.wav")!;
    expect(thunder).toMatchObject({ mediaType: "audio", creator: "Subhashish Panigrahi", licence: { id: "CC-BY-SA-4.0", attributionRequired: true, url: "https://creativecommons.org/licenses/by-sa/4.0/" } });
    expect(thunder.attribution).toBe("«Thunder» by Subhashish Panigrahi (2019-08-06), Wikimedia Commons. CC-BY-SA-4.0, https://creativecommons.org/licenses/by-sa/4.0/");
  });

  it("reads one file page again by its title", async () => {
    const http = recorded([[/titles=/, "commons-item.json"]]);
    const item = await commons.item("File:Albert Bierstadt - A Storm in the Rocky Mountains, Mt. Rosalie - Google Art Project.jpg", http);
    expect(item.licence.id).toBe("public-domain");
  });
});

describe("Art Institute of Chicago", () => {
  it("asks for public-domain works only, naming itself, and serves IIIF at most 3000 px", async () => {
    const http = recorded([[/artworks\/search/, "aic-search.json"]]);
    const items = await aic.search("storm", opts(), http);
    expect(http.asked[0]!.url).toContain("query%5Bterm%5D%5Bis_public_domain%5D=true");
    expect(http.asked[0]!.headers).toEqual({ "AIC-User-Agent": "test-agent (test@example.invalid)" });
    const wave = items.find((i) => i.id === "24645")!;
    expect(wave).toMatchObject({ licence: { id: "public-domain", basis: "aic:is_public_domain" }, width: 3000, height: 2056, creator: "Katsushika Hokusai 葛飾 北斎" });
    expect(wave.fileUrl).toBe("https://www.artic.edu/iiif/2/b3974542-b9b4-7568-fc4b-966738f61d78/full/3000,/0/default.jpg");
    expect(wave.fileHeaders).toEqual({ "AIC-User-Agent": "test-agent (test@example.invalid)" });
  });
});

describe("Cleveland Museum of Art", () => {
  it("takes the print JPEG of a CC0 work, not its TIFF", async () => {
    const http = recorded([[/artworks\/144732/, "cma-item.json"]]);
    const item = await cleveland.item("144732", http);
    expect(item).toMatchObject({ title: "Storm in the Mountains", licence: { id: "CC0-1.0" }, mime: "image/jpeg", width: 2824, height: 3400, creator: "Frederic Edwin Church (American, 1826–1900)" });
    expect(item.fileUrl).toMatch(/_print\.jpg$/);
  });
});

describe("The Met", () => {
  it("searches with v1.1, then reads each object; Open Access is CC0", async () => {
    const http = recorded([[/v1\.1\/search/, "met-search.json"], [/v1\/objects\/11766$/, "met-item.json"], [/v1\/objects\//, "met-item.json"]]);
    const items = await met.search("storm", opts("image", 1), http);
    expect(http.asked[0]!.url).toContain("/v1.1/search?");
    expect(items[0]).toMatchObject({ id: "11766", title: "Thomas Storm", creator: "Ammi Phillips", licence: { id: "CC0-1.0" }, fileUrl: "https://images.metmuseum.org/CRDImages/ad/original/ap1980.360.1.jpg" });
  });
});

describe("NASA", () => {
  it("reads the original from the asset manifest, over https", async () => {
    const http = recorded([[/search\?nasa_id=/, "nasa-item.json"], [/asset\//, "nasa-asset.json"]]);
    const item = await nasa.item("PIA01118", http);
    expect(item).toMatchObject({ title: "Jovian Lightning", licence: { id: "public-domain", basis: "NASA media guidelines" }, fileUrl: "https://images-assets.nasa.gov/image/PIA01118/PIA01118~orig.jpg" });
  });

  it("never assumes free an item that mentions a copyright", async () => {
    const http: Http = { userAgent: "t", json: async () => ({ collection: { items: [{ data: [{ nasa_id: "x1", media_type: "image", title: "Launch", description: "Photo © 2020 Some Agency" }], links: [] }] } }) };
    const [item] = await nasa.search("launch", opts(), http);
    expect(item!.licence.id).toBe("unknown");
  });

  it("prefers ~orig, then the largest rendition", () => {
    expect(originalOf(["http://a/x~thumb.jpg", "http://a/x~orig.jpg"], "image")).toBe("https://a/x~orig.jpg");
    expect(originalOf(["https://a/v~small.mp4", "https://a/v~large.mp4"], "video")).toBe("https://a/v~large.mp4");
  });
});

describe("Openverse", () => {
  it("keeps the source's licence and landing page, and ids by medium", async () => {
    const http = recorded([[/images\/\?/, "openverse-search.json"]]);
    const [first] = await openverse.search("thunderstorm", opts(), http);
    expect(first).toMatchObject({ id: "images/4a23caa9-e375-4ce3-9a5b-4a72d5ef7b51", licence: { id: "CC-BY-2.0" }, creator: "enneafive", landingUrl: "https://www.flickr.com/photos/75612671@N03/28600395003", institution: "flickr" });
  });

  it("reads a sound's duration in seconds", async () => {
    const http = recorded([[/audio\/\?/, "openverse-audio-search.json"]]);
    const [first] = await openverse.search("thunder", opts("audio"), http);
    expect(first).toMatchObject({ mediaType: "audio", durationSeconds: 368, licence: { id: "CC-BY-3.0" } });
  });

  it("refuses an id that is not images/<uuid> or audio/<uuid>", async () => {
    await expect(openverse.item("../admin", recorded([]))).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("Internet Archive", () => {
  it("searches only items with a licence, and takes the largest original file", async () => {
    const http = recorded([[/advancedsearch/, "ia-search.json"], [/metadata\//, "ia-item.json"]]);
    const found = await internetArchive.search("thunderstorm", opts("video"), http);
    expect(decodeURIComponent(http.asked[0]!.url.replace(/\+/g, " "))).toContain("mediatype:movies AND licenseurl:*");
    expect(found[0]!.fileUrl).toBe("");
    const item = await internetArchive.item("Flickr-9430591870", http);
    expect(item).toMatchObject({ mediaType: "video", title: "Toronto Hail", width: 1920, height: 1080, durationSeconds: 28.16, licence: { id: "CC-BY-ND-2.0" } });
    expect(item.fileUrl).toBe("https://archive.org/download/Flickr-9430591870/Toronto_Hail-9430591870.mp4");
  });
});

describe("review fixes", () => {
  it("NASA: free only when credited to NASA; another agency's or a photographer's credit is unknown", async () => {
    const entry = (data: Record<string, unknown>) => ({ collection: { items: [{ data: [{ nasa_id: "x", media_type: "image", title: "T", center: "JSC", ...data }], links: [] }] } });
    const one = async (data: Record<string, unknown>) => (await nasa.search("q", opts(), { userAgent: "t", json: async () => entry(data) }))[0]!.licence.id;
    expect(await one({ secondary_creator: "NASA/JPL-Caltech" })).toBe("public-domain");
    expect(await one({})).toBe("public-domain");
    expect(await one({ secondary_creator: "ESA/Hubble" })).toBe("unknown");
    expect(await one({ photographer: "Getty Images" })).toBe("unknown");
    expect(await one({ description: "A launch. Image credit: SpaceX" })).toBe("unknown");
    expect(await one({ center: "Not a centre" })).toBe("unknown");
  });

  it("Cleveland: the full TIFF when there is no print, never the small web image", async () => {
    const http: Http = { userAgent: "t", json: async () => ({ data: { id: 1, title: "T", share_license_status: "CC0", url: "https://clevelandart.org/art/1", images: { web: { url: "https://x/1_web.jpg", width: "800", height: "600" }, full: { url: "https://x/1_full.tif", width: "4000", height: "3000" } } } }) };
    expect((await cleveland.item("1", http)).fileUrl).toBe("https://x/1_full.tif");
  });

  it("Internet Archive: two different licences on one item make it unknown", async () => {
    const http: Http = { userAgent: "t", json: async () => ({ metadata: { identifier: "a", mediatype: "audio", title: "A", licenseurl: ["https://creativecommons.org/licenses/by/4.0/", "https://creativecommons.org/licenses/by-nc/4.0/"] }, files: [{ name: "a.flac", source: "original", size: "10" }] }) };
    expect((await internetArchive.item("a", http)).licence.id).toBe("unknown");
  });
});

describe("review fixes: what is not an original", () => {
  it("Openverse: a Freesound sound is only a preview, so it has no file to fetch", async () => {
    const result = { id: "8bee509f-b566-4b57-9251-9adf44e55728", title: "Thunder", url: "https://cdn.freesound.org/previews/1/1-hq.mp3", license: "cc0", source: "freesound", foreign_landing_url: "https://freesound.org/s/1" };
    const http: Http = { userAgent: "t", json: async (url) => (url.includes("/audio/?") ? { results: [result] } : result) };
    const [found] = await openverse.search("thunder", opts("audio"), http);
    expect(found!.fileUrl).toBe("");
    await expect(openverse.item("audio/8bee509f-b566-4b57-9251-9adf44e55728", http)).rejects.toThrow(/only Freesound's preview/);
  });

  it("AIC offers no preview URL a viewer cannot open", async () => {
    const http = recorded([[/artworks\/search/, "aic-search.json"]]);
    expect((await aic.search("storm", opts(), http))[0]!.previewUrl).toBeUndefined();
  });
});
