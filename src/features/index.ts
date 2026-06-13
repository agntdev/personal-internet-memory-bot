// Aggregates every feature installer in registration order.
// main.ts + harness-entry.ts both call this; tests can override
// by passing an explicit `features` array to buildBot().

import type { Feature } from "../features.js";
import { startFeature } from "./start.js";
import { helpFeature } from "./help.js";
import { saveFeature } from "./save.js";

export const defaultFeatures: Feature[] = [
  startFeature,
  helpFeature,
  saveFeature,
];
