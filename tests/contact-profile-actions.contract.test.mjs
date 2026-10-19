import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("contact profile keeps Email but omits unsupported Schedule, Chat, and Video quick actions", () => {
  const page = readFileSync(new URL("../app/contacts/page.tsx", import.meta.url), "utf8");

  // The quick action is a mailto link captioned "Email" (the QuickAction label prop was removed).
  assert.match(page, /href=\{`mailto:\$\{email\}`\}[^>]*>[\s\S]{0,300}?>Email<\/span>/, "Email quick action must remain");
  assert.doesNotMatch(page, /label="Schedule"/, "Schedule quick action must be removed");
  assert.doesNotMatch(page, /label="Chat"/, "Chat quick action must be removed");
  assert.doesNotMatch(page, /label="Video"/, "Video quick action must be removed");
});
