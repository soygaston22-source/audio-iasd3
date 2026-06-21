import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Vercel." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const { message, history = [], model: modelType, imageBase64, imageMimeType } = await req.json();
    
    // Selección de modelo (por defecto Pro, como solicitó el usuario)
    const selectedModel = modelType === 'flash' ? 'gemini-1.5-flash-latest' : 'gemini-1.5-pro-latest';
    
    const genAI = new GoogleGenerativeAI(apiKey.trim().replace(/^"|"$|^'|'$/g, ''));
    
    const systemInstruction = "Eres un asistente virtual amigable y experto para la aplicación 'Audio IASD'. Ayudas a los usuarios del departamento de audio de la iglesia con sus dudas técnicas, turnos de la semana y analizando cualquier documento o foto que te envíen. Sé cálido, conciso y útil.";

    // Inicializar modelo con instrucciones de sistema
    const model = genAI.getGenerativeModel({ 
      model: selectedModel,
      systemInstruction: {
        parts: [{ text: systemInstruction }],
        role: "system"
      }
    });
    
    // Mapear historial al formato de Gemini
    const formattedHistory = history.map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    }));

    const chat = model.startChat({
      history: formattedHistory,
    });

    // Construir los 'parts' para soportar imágenes si el usuario adjunta una
    let messageParts: any = message;
    if (imageBase64) {
      const base64Data = imageBase64.split(',')[1] || imageBase64;
      messageParts = [
        { text: message || "Analiza esta imagen." },
        { 
          inlineData: { 
            data: base64Data, 
            mimeType: imageMimeType || 'image/jpeg' 
          } 
        }
      ];
    }

    const result = await chat.sendMessage(messageParts);
    const responseText = result.response.text();
    
    return new Response(JSON.stringify({ text: responseText }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error("Error en IA:", error);
    return new Response(JSON.stringify({ error: error.message || "Error procesando la petición a la IA" }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
