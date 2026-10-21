/** Filler a recruiter skims past, or distrusts when nothing backs it up. Shared with the tailoring validators. */
export const FLUFF_RE = new RegExp(
  "\\b(" + [
    "robust", "large[- ]scale", "world[- ]class", "best[- ]in[- ]class", "cutting[- ]edge", "state[- ]of[- ]the[- ]art", "passionate",
    "dynamic", "results[- ]driven", "detail[- ]oriented", "team player", "go[- ]getter", "self[- ]starter", "highly motivated",
    "proven track record", "track record of", "synerg\\w+", "thought leader", "rock ?star", "ninja", "guru", "think outside the box",
    "hard[- ]working", "fast[- ]paced", "seasoned", "visionary", "game[- ]chang\\w+", "mission[- ]critical", "end[- ]to[- ]end expert\\w*",
    "expertise in", "extensive experience", "wealth of experience", "strong background", "excellent communication",
  ].join("|") + ")\\b", "i");
