export default async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response("", {
      status: 200,
      headers,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
      }),
      {
        status: 405,
        headers,
      }
    );
  }

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "GEMINI_API_KEY is missing in Netlify",
        }),
        {
          status: 500,
          headers,
        }
      );
    }

    const body = await req.json();

    const {
      prompt,
      systemInstruction,
      schema,
    } = body;

    if (!prompt) {
      return new Response(
        JSON.stringify({
          error: "Prompt is missing",
        }),
        {
          status: 400,
          headers,
        }
      );
    }

    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    };

    if (systemInstruction) {
      payload.systemInstruction = {
        parts: [
          {
            text: systemInstruction,
          },
        ],
      };
    }

    if (schema) {
      payload.generationConfig.responseSchema = schema;
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 45000);

    let response;

    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        "Gemini API Error:",
        response.status,
        responseText
      );

      return new Response(
        JSON.stringify({
          error: `Gemini API returned ${response.status}`,
          details: responseText,
        }),
        {
          status: 502,
          headers,
        }
      );
    }

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Invalid JSON received from Gemini",
          details: responseText,
        }),
        {
          status: 502,
          headers,
        }
      );
    }

    const generatedText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!generatedText) {
      return new Response(
        JSON.stringify({
          error: "Gemini returned an empty response",
          details: JSON.stringify(data),
        }),
        {
          status: 502,
          headers,
        }
      );
    }

    let result;

    try {
      result = JSON.parse(generatedText);
    } catch {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[0]);
        } catch {
          result = {
            summary: generatedText,
          };
        }
      } else {
        result = {
          summary: generatedText,
        };
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: result,
      }),
      {
        status: 200,
        headers,
      }
    );

  } catch (error) {
    console.error("Function Error:", error);

    const isTimeout = error?.name === "AbortError";

    return new Response(
      JSON.stringify({
        error: isTimeout
          ? "Gemini request timed out after 45 seconds"
          : error?.message || "Unknown server error",
      }),
      {
        status: 504,
        headers,
      }
    );
  }
};
