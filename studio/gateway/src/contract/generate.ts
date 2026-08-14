#!/usr/bin/env node
import { generateContract } from "../contract/index.js";

generateContract().catch((err) => {
  console.error("Contract generation failed:", err);
  process.exit(1);
});
