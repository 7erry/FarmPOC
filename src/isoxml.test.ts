import assert from "node:assert/strict";
import { buildTaskDataXml } from "./isoxml.ts";

const xml = buildTaskDataXml({
  taskName: "A&B",
  fieldName: "North 40",
  vehicleName: "AGCO Rogator",
  operationType: "Spray",
});
assert.match(xml, /ISO11783_TaskData/);
assert.match(xml, /A&amp;B/);
assert.doesNotMatch(xml, /A&B/);
console.log("isoxml checks passed");
