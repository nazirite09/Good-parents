import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export async function getCounselingResponse(history: ChatMessage[], message: string) {
  try {
    const formattedHistory = history.map(h => ({
      role: h.role,
      parts: [{ text: h.text }]
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...formattedHistory,
        { role: "user", parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: `당신은 '맘파파 AI 상담소'의 전문 육아 상담사입니다. 
당신의 목표는 초보 부모님들에게 따뜻하고, 격려하며, 전문적인 조언을 제공하는 것입니다.

사용 지침:
1. 어조: 매우 친절하고, 공감하며, 따뜻한 톤을 유지하세요. "정말 고생 많으세요", "당신은 충분히 잘하고 계세요" 같은 정서적 지지 문구를 자주 사용하세요.
2. 전문성: 소아청소년과 전문의나 베테랑 육아 전문가 수준의 정확한 정보를 제공하되, 이해하기 쉬운 언어로 설명하세요.
3. 답변 구조: 
   - 첫 문장은 부모님의 힘듦에 대한 공감으로 시작하세요.
   - 구체적인 해결책이나 팁을 제공하세요.
   - 마지막에는 힘내라는 응원의 메시지로 마무리하세요.
4. 안전: 의학적 진단이 필요한 심각한 상황(고열, 경련 등)인 경우 반드시 병원 방문을 권유하세요.
5. 언어: 반드시 한국어로 답변하세요.`,
        temperature: 0.8,
      },
    });

    return response.text || "죄송합니다. 잠시 후 다시 시도해 주세요.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "연결에 문제가 발생했습니다. 네트워크 상태를 확인해 주세요.";
  }
}
