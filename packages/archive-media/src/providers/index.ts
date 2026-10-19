import { aic } from "./aic.js";
import { cleveland } from "./cleveland.js";
import { commons } from "./commons.js";
import { freesound } from "./freesound.js";
import { internetArchive } from "./internet-archive.js";
import { met } from "./met.js";
import { nasa } from "./nasa.js";
import { openverse } from "./openverse.js";
import type { Provider } from "../types.js";
import { pexels, pixabay, unsplash, coverr } from "./stock.js";
import { smithsonian, rijksmuseum, wellcome } from "./collections.js";
import { inaturalist, jamendo, ccmixter } from "./nature-music.js";
import { iconify, emoji, lottie } from "./graphics.js";
import { mapillary } from "./mapillary.js";
import { polyhaven, ambientcg } from "./textures.js";
import { fontsource } from "./fonts.js";
import { illustrations } from "./illustrations.js";

/** Every provider, in the order their results are listed: museums first, then the open collections. */
export const PROVIDERS: Provider[] = [aic, met, cleveland, commons, nasa, internetArchive, openverse, freesound,
  pexels, pixabay, unsplash, coverr, smithsonian, rijksmuseum, wellcome, inaturalist, jamendo, ccmixter,
  iconify, emoji, lottie, mapillary, polyhaven, ambientcg, fontsource, illustrations];

export { aic, cleveland, commons, freesound, internetArchive, met, nasa, openverse,
  pexels, pixabay, unsplash, coverr, smithsonian, rijksmuseum, wellcome, inaturalist, jamendo, ccmixter,
  iconify, emoji, lottie, mapillary, polyhaven, ambientcg, fontsource, illustrations };
