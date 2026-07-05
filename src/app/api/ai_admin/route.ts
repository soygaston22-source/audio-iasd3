import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY no está configurada.' }, { status: 500 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const systemPrompt = `
      Eres el Asistente Inteligente del Administrador de Turnos de Audio de una iglesia.
      El administrador te pedirá organizar cronogramas mensuales. 
      Tus respuestas DEBEN ser ÚNICAMENTE un objeto JSON válido con el siguiente formato, sin ningún texto adicional, sin bloques de código Markdown, solo el JSON raw:

      {
        "title": "Cronograma - Mes Año",
        "rows": [
          {
            "date": "Sábado DD/MM",
            "morning": "Nombre1 - Nombre2",
            "afternoon": "Nombre3 - Nombre4"
          }
        ]
      }

      El equipo es: Josias, Valentino, Santiago, Leonel, Tomas, Facundo, Anibal, Gaston.
      Sigue estrictamente las restricciones que te dé el usuario (ej. Santiago solo los sábados por la tarde).
    `;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: systemPrompt + "\\n\\n" + prompt }] }],
      generationConfig: {
        temperature: 0.1
      }
    });

    const response = await result.response;
    let text = response.text().trim();
    if (text.startsWith("\`\`\`json")) text = text.replace(/^\`\`\`json/, '');
    if (text.startsWith("\`\`\`")) text = text.replace(/^\`\`\`/, '');
    if (text.endsWith("\`\`\`")) text = text.replace(/\`\`\`$/, '');
    text = text.trim();

    // Check valid JSON
    JSON.parse(text);

    return NextResponse.json({ response: text });
  } catch (error: any) {
    console.error('Error in AI Admin Route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
