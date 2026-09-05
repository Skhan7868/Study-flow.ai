exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { subject, time, syllabus } = JSON.parse(event.body);
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    const prompt = `Create a detailed study plan for:
Subject: ${subject}
Available time: ${time} minutes per day
Syllabus: ${syllabus}

Break this into daily sessions. Return JSON format:
{
  "plan": [
    {
      "day": 1,
      "topic": "topic name",
      "duration": ${time},
      "subtopics": ["subtopic1", "subtopic2"],
      "notes": "brief description"
    }
  ],
  "totalDays": number,
  "summary": "brief summary"
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    let plan;
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      plan = jsonMatch ? JSON.parse(jsonMatch[0]) : { plan: [], summary: generatedText };
    } catch {
      plan = { plan: [], summary: generatedText };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: plan })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
