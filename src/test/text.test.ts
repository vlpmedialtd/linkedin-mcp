import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeLittleText, formatCommentary } from "../text.js";

test("escapes reserved little-text characters", () => {
  assert.equal(escapeLittleText("Hi (all) [x] @me *bold* _u_ ~s~ <a> {b} | \\"), "Hi \\(all\\) \\[x\\] \\@me \\*bold\\* \\_u\\_ \\~s\\~ \\<a\\> \\{b\\} \\| \\\\");
});

test("converts hashtags and escapes the rest", () => {
  assert.equal(formatCommentary("Launch! #MCP #künstliche_Intelligenz (beta)"), "Launch! {hashtag|\\#|MCP} {hashtag|\\#|künstliche_Intelligenz} \\(beta\\)");
});

test("hashtag at start and inside words", () => {
  assert.equal(formatCommentary("#AI rocks, C#dev stays"), "{hashtag|\\#|AI} rocks, C\\#dev stays");
});

test("hashtag conversion can be disabled", () => {
  assert.equal(formatCommentary("#AI", { hashtags: false }), "\\#AI");
});
