// Aggregates every feature installer in registration order.
// main.ts + harness-entry.ts both call this; tests can override
// by passing an explicit `features` array to buildBot().

import type { Feature } from "../features.js";
import { startFeature } from "./start.js";
import { helpFeature } from "./help.js";
import { listFeature } from "./list.js";
import { saveFeature } from "./save.js";
import { searchFeature } from "./search.js";
import { tagsFeature } from "./tags.js";
import { digestFeature } from "./digest.js";
import { cancelFeature } from "./cancel.js";

export const defaultFeatures: Feature[] = [
  startFeature,
  helpFeature,
  listFeature,
  saveFeature,
  searchFeature,
  tagsFeature,
  digestFeature,
  cancelFeature,
];
