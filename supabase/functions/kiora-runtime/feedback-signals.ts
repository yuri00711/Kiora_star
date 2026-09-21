export type FeedbackSignal = {
  type: "correction" | "rejected" | "accepted" | "preference";
  content: string;
} | null;

export function explicitFeedback(textValue: string): FeedbackSignal {
  const content = textValue.trim();
  if (content.length < 4) return null;
  if (/(你记错了|你搞错了|这不对|不是这样|不是.+而是|不是.+是|我说的是|纠正一下|请更正|覚え違い|違います|not what i said|that's wrong|you got .* wrong)/i.test(content)) {
    return { type: "correction", content };
  }
  if (/(我不喜欢这种回答|不要这样回答|别再这样|这个回答不行|この答え方は嫌|don't answer like that)/i.test(content)) {
    return { type: "rejected", content };
  }
  if (/(请记住|以后请|以后.{0,24}(不要|别|请)|我希望你以后|回答时请|これからは|please remember|from now on)/i.test(content)) {
    return { type: "preference", content };
  }
  if (/(对，就是这样|这个回答很好|这样回答就好|正是我想要的|この感じでいい|exactly what i meant)/i.test(content)) {
    return { type: "accepted", content };
  }
  return null;
}

export function requestsReflection(textValue: string): boolean {
  return /(整理.{0,8}(记忆|这段对话)|总结.{0,8}(我们|这段对话)|回顾.{0,8}(我们|这段对话)|记忆を整理|会話を振り返|reflect on (this|our) conversation|organize (our|your) memor)/i.test(textValue);
}
