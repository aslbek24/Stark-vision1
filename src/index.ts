import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL ?? true }));
app.use(express.json({ limit: '4mb' }));

// Simple per-IP rate limit: 30 requests / minute.
const hits = new Map<string, number[]>();
app.use('/api', (req, res, next) => {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 30) return res.status(429).json({ error: 'So‘rovlar limiti tugadi. Biroz kuting.' });
  recent.push(now);
  hits.set(key, recent);
  next();
});

const SYSTEM = `Foydalanuvchi tanlagan tilda javob bering.
Agar foydalanuvchi ingliz tilini tanlasa, faqat ingliz tilida javob bering.
Agar foydalanuvchi o‘zbek tilini tanlasa, faqat o‘zbek tilida javob bering.
Har doim 1-3 ta qisqa va tushunarli gap bilan javob bering.`;

const apiKey = () => process.env.GEMINI_API_KEY?.trim();
app.get('/api/health', (_req, res) => {
  res.json({ mode: apiKey() ? 'live' : 'demo', provider: 'Gemini' });
});

app.post('/api/analyze', async (req, res) => {
  const { question, image } = req.body as { question?: string; image?: string | null };
  if (typeof question !== 'string' || !question.trim() || question.length > 500) {
    return res.status(400).json({ error: 'Savol bo‘sh yoki juda uzun.' });
  }

  let imageBase64: string | undefined;
  if (image) {
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!match) return res.status(400).json({ error: 'Rasm JPEG formatida bo‘lishi kerak.' });
    imageBase64 = match[1];
  }

  const key = apiKey();
  if (!key) {
    return res.json({
      demo: true,
      text: '[DEMO — simulyatsiya] Bu haqiqiy AI tahlili emas. Gemini ulanishi uchun server/.env fayliga GEMINI_API_KEY kiriting.',
    });
  }

  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';
  const parts: Array<Record<string, unknown>> = [{ text: question }];
  if (imageBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 220 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const data = await response.json() as any;
    if (!response.ok) {
      const message = data?.error?.message || 'Gemini xizmatida xatolik yuz berdi.';
      const status = response.status === 400 ? 400 : response.status === 401 || response.status === 403 ? 502 : response.status === 429 ? 429 : 502;
      return res.status(status).json({ error: `Gemini API (${response.status}): ${message}` });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? '')
      .join('')
      .trim();
    if (!answer) return res.status(502).json({ error: 'Gemini javob qaytarmadi. Boshqa savol bilan urinib ko‘ring.' });
    return res.json({ demo: false, text: answer });
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? 'Gemini javobi kutilgan vaqtda kelmadi. Qayta urinib ko‘ring.'
      : 'Gemini serveriga ulanib bo‘lmadi. Internet va server holatini tekshiring.';
    return res.status(504).json({ error: message });
  }
});

const port = Number(process.env.PORT ?? 8788);
app.listen(port, () => console.log(`STARK VISION Gemini API on :${port}`));
