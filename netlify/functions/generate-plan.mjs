export default async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("", {
      status: 200,
      headers,
    });
  }

  // Only POST is allowed
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
    // --------------------------------------------------
    // 1. Get Gemini API key from Netlify environment
    // --------------------------------------------------

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing");

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

    // --------------------------------------------------
    // 2. Read request body
    // --------------------------------------------------

    let body;

    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
        }),
        {
          status: 400,
          headers,
        }
      );
    }

    const {
      prompt,
      systemInstruction,
      schema,
    } = body;

    // --------------------------------------------------
    // 3. Validate prompt
    // --------------------------------------------------

    if (!prompt || typeof prompt !== "string") {
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

    // --------------------------------------------------
    // 4. Gemini API endpoint
    // --------------------------------------------------

    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

    // --------------------------------------------------
    // 5. Build Gemini request
    // --------------------------------------------------

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

        // Lowest reasoning effort for faster responses
        thinkingConfig: {
          thinkingLevel: "minimal",
        },

        // Keep output reasonably small for faster response
        maxOutputTokens: 1800,
      },
    };

    // --------------------------------------------------
    // 6. Add system instruction if provided
    // --------------------------------------------------

    if (
      systemInstruction &&
      typeof systemInstruction === "string"
    ) {
      payload.systemInstruction = {
        parts: [
          {
            text: systemInstruction,
          },
        ],
      };
    }

    // --------------------------------------------------
    // 7. Add response schema if provided
    // --------------------------------------------------

    if (schema) {
      payload.generationConfig.responseSchema = schema;
    }

    // --------------------------------------------------
    // 8. Create 18-second timeout
    // --------------------------------------------------

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 18000);

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
    } catch (error) {
      clearTimeout(timeout);

      if (error?.name === "AbortError") {
        console.error("Gemini request timed out");

        return new Response(
          JSON.stringify({
            error:
              "AI request timed out. Please try again.",
          }),
          {
            status: 504,
            headers,
          }
        );
      }

      console.error(
        "Gemini network error:",
        error
      );

      return new Response(
        JSON.stringify({
          error:
            error?.message ||
            "Unable to connect to Gemini API",
        }),
        {
          status: 502,
          headers,
        }
      );
    }

    clearTimeout(timeout);

    // --------------------------------------------------
    // 9. Read Gemini response
    // --------------------------------------------------

    const responseText = await response.text();

    // --------------------------------------------------
    // 10. Handle Gemini API errors
    // --------------------------------------------------

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

    // --------------------------------------------------
    // 11. Parse Gemini response JSON
    // --------------------------------------------------

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        "Invalid JSON from Gemini:",
        responseText
      );

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

    // --------------------------------------------------
    // 12. Extract generated text
    // --------------------------------------------------

    const generatedText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (!generatedText) {
      console.error(
        "Gemini returned no generated text:",
        JSON.stringify(data)
      );

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

    // --------------------------------------------------
    // 13. Convert generated JSON text to object
    // --------------------------------------------------

    let result;

    try {
      result = JSON.parse(generatedText);
    } catch {
      // Try extracting JSON object from text
      const objectMatch =
        generatedText.match(/\{[\s\S]*\}/);

      if (objectMatch) {
        try {
          result = JSON.parse(objectMatch[0]);
        } catch {
          result = {
            summary: generatedText,
          };
        }
      } else {
        // Fallback
        result = {
          summary: generatedText,
        };
      }
    }

    // --------------------------------------------------
    // 14. Successful response
    // --------------------------------------------------

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
    // --------------------------------------------------
    // 15. Final unexpected error
    // --------------------------------------------------

    console.error(
      "Netlify Function Error:",
      error
    );

    return new Response(
      JSON.stringify({
        error:
          error?.message ||
          "Unknown server error",
      }),
      {
        status: 500,
        headers,
      }
    );
  }
};
