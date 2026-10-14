import assert from "node:assert/strict";
import { anomalySample, clampIntervalMs } from "./simulator.ts";

assert.equal(clampIntervalMs(100), 500);
assert.equal(clampIntervalMs(9000), 5000);
assert.equal(clampIntervalMs(1500.4), 1500);
assert.equal(clampIntervalMs(Number.NaN), 1000);

const failure = anomalySample(12, "DEVICE_FAILURE");
assert.equal(failure.speedKph, 0);
assert.equal(failure.advance, false);

const freeze = anomalySample(12, "FREEZE_EVENT");
assert.equal(freeze.speedKph, 0);
assert.equal(freeze.advance, false);

const spike = anomalySample(10, "SPEED_SPIKE");
assert.equal(spike.speedKph, 30);
assert.equal(spike.advance, true);
