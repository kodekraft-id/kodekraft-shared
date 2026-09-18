-- placeholder migration for the consumer-pass fixture; R7 is exercised separately
-- with its own dynamically-built fixture in test/check-ownership.test.ts, since it
-- needs a real, computed sha256 lock file.
CREATE TABLE placeholder (id TEXT PRIMARY KEY);
