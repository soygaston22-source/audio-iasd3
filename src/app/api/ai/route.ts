import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Vercel." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const { message, history = [], model: modelType, imageBase64, imageMimeType } = await req.json();
    
    // Obtener la lista de modelos permitidos para esta API Key específica
    let availableModels: string[] = [];
    try {
      const listResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim().replace(/^"|"$|^'|'$/g, '')}`);
      const listData = await listResponse.json();
      if (listData.models) {
        availableModels = listData.models.map((m: any) => m.name.replace('models/', ''));
      }
    } catch (e) {
      console.error("Error fetching models list", e);
    }

    // Función auxiliar para elegir el mejor modelo disponible
    const findBestModel = (preferences: string[]) => {
      for (const pref of preferences) {
        if (availableModels.includes(pref)) return pref;
      }
      // Si no encuentra ninguno preferido pero hay modelos, usa el primero que contenga 'flash' o el primero absoluto.
      const anyFlash = availableModels.find(m => m.includes('flash'));
      return anyFlash || availableModels[0] || 'gemini-1.5-flash';
    };

    let selectedModel = 'gemini-1.5-flash';
    if (availableModels.length > 0) {
      if (modelType === 'flash') {
        selectedModel = findBestModel(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash']);
      } else if (modelType === 'pro') {
        selectedModel = findBestModel(['gemini-2.5-pro', 'gemini-1.5-pro-latest', 'gemini-1.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']);
      } else if (modelType === 'banana') {
        selectedModel = findBestModel(['nano-banana-pro-preview', 'gemini-3-pro-preview', 'gemini-2.5-pro']);
      }
    }
    
    const genAI = new GoogleGenerativeAI(apiKey.trim().replace(/^"|"$|^'|'$/g, ''));
    
    const systemInstruction = "Eres un asistente virtual amigable y experto para la aplicación 'Audio IASD'. Ayudas a los usuarios del departamento de audio de la iglesia con sus dudas técnicas, turnos de la semana y analizando cualquier documento o foto que te envíen. Sé cálido, conciso y útil.";

    // Inicializar modelo
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
      let errorMessage = error.message || "Error procesando la petición a la IA";
      return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
