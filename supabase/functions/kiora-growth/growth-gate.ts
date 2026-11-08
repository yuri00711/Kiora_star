export type GateCase = { id?: unknown; suite?: unknown; severity?: unknown; passed?: unknown };

export function evaluateRegressionGate(cases: GateCase[]): {
  result: "passed" | "warning" | "blocked";
  blockedReasons: string[];
  warningCaseIds: string[];
} {
  const criticalFailures = cases.filter((item) => item.passed !== true && item.severity === "critical");
  const warningFailures = cases.filter((item) => item.passed !== true && item.severity !== "critical");
  return {
    result: criticalFailures.length ? "blocked" : warningFailures.length ? "warning" : "passed",
    blockedReasons: criticalFailures.map((item) => `critical_case_failed:${String(item.id || "unknown")}`),
    warningCaseIds: warningFailures.map((item) => String(item.id || "unknown")),
  };
}
