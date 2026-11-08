export type TemporaryOverlayDraft = {
  scope: "communication_style" | "response_behavior" | "relationship_behavior" | "preference_handling" | "correction_rule" | "conversational_habit";
  instruction: string;
  sourceKind: "explicit_correction";
  ttlDays: number;
};

function text(value: unknown, max = 520): string {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

const PROTECTED_TARGET = /(?:core\s*(?:identity|definition|principle)|owner\s*(?:identity|permission)|auth(?:entication|orization)?|row[-\s]?level\s+security|\brls\b|safety\s*(?:rule|policy)|tool\s*(?:permission|authority)|system\s*(?:security|policy)|budget\s*(?:limit|policy)|raw\s+memory\s+evidence|factual\s+knowledge|核心身份|所有者权限|身份认证|行级安全|安全规则|工具权限|预算限制|原始记忆证据|事实知识)/iu;

export function temporaryOverlayFromMessage(value: unknown): TemporaryOverlayDraft | null {
  const message = text(value, 1_200);
  if (!message || PROTECTED_TARGET.test(message)) return null;
  const correctionSignal = /(别|不要|别再|别每次|以后别|请勿|しないで|やめて|don't|do not|stop)/iu.test(message);
  const behaviorSignal = /(建议|说教|安慰|陪聊|回复|回答|语气|措辞|称呼|追问|总结|解决方案|advice|respond|reply|tone|wording|lecture|solution|comfort)/iu.test(message);
  if (!correctionSignal || !behaviorSignal) return null;
  const scope = /(称呼|关系|亲密|距离|relationship|nickname)/iu.test(message)
    ? "relationship_behavior" : /(语气|措辞|回复|回答|respond|reply|tone|wording)/iu.test(message)
    ? "communication_style" : "correction_rule";
  return {
    scope,
    instruction: `For similar replies, immediately honor this explicit OWNER correction: ${message}`.slice(0, 520),
    sourceKind: "explicit_correction",
    ttlDays: 14,
  };
}
