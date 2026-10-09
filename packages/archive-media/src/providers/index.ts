import { aic } from "./aic.js";
import { cleveland } from "./cleveland.js";
import { commons } from "./commons.js";
import { internetArchive } from "./internet-archive.js";
import { met } from "./met.js";
import { nasa } from "./nasa.js";
import { openverse } from "./openverse.js";
import type { Provider } from "../types.js";

/** Every provider, in the order their results are listed: museums first, then the open collections. */
export const PROVIDERS: Provider[] = [aic, met, cleveland, commons, nasa, internetArchive, openverse];

export { aic, cleveland, commons, internetArchive, met, nasa, openverse };
