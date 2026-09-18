// R3 violation: reaches around the exports map straight into src/, instead of importing
// the public "@kodekraft/shared/ownership" subpath.
import { ownershipMatrix } from "@kodekraft/shared/src/ownership.ts";

export { ownershipMatrix };
