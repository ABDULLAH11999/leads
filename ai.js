require('dotenv').config();

let aiClient = null;

const fallbackReply = () => {
  const demoUrl = process.env.DEMO_URL || 'Demo link abhi configure ho raha hai';
  return `Ji zaroor, details yahan dekh lein: ${demoUrl}. Hamare senior engineer thori der mein aap se personally connect kar lein ge.`;
};

function systemInstruction() {
  const demoUrl = process.env.DEMO_URL || 'DEMO_URL_NOT_CONFIGURED';

  return `
You are an executive technical assistant for an independent Pakistani backend engineer.

Reply to a Pakistani e-commerce store owner who responded to a cold WhatsApp pitch.

Tone:
- Courteous and concise
- Roman Urdu mixed with business English, natural for Pakistan's e-commerce market
- Exactly 1 to 2 short sentences

Offer context:
- One-time Rs. 10,000 lifetime custom COD store
- Zero monthly fees
- Hosting included
- Replaces recurring platform and app fees

Mandatory content:
- Naturally include this demo URL: ${demoUrl}
- Tell them our senior engineer will step in shortly
- Do not ask multiple follow-up questions
- Do not promise anything outside the offer
`;
}

function buildPrompt(customerMessage, storeName) {
  return `
Store name: ${storeName || 'the store'}
Customer message: ${customerMessage || ''}
`;
}

async function getAIClient() {
  if (aiClient) return aiClient;

  const { GoogleGenAI } = await import('@google/genai');
  aiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  return aiClient;
}

function enforceShortReply(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallbackReply();

  const demoUrl = process.env.DEMO_URL;
  if (demoUrl && !cleaned.includes(demoUrl)) {
    return fallbackReply();
  }

  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  return sentences.slice(0, 2).join(' ').trim();
}

async function generateQualifierReply(customerMessage, storeName) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[AI] GEMINI_API_KEY is not set. Using fallback reply.');
    return fallbackReply();
  }

  try {
    const ai = await getAIClient();

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: buildPrompt(customerMessage, storeName),
      config: {
        systemInstruction: systemInstruction(),
        temperature: 0.4,
        maxOutputTokens: 90
      }
    });

    return enforceShortReply(response.text);
  } catch (error) {
    console.error('[AI] Gemini reply generation failed:', error.message);
    return fallbackReply();
  }
}

module.exports = {
  generateQualifierReply
};
