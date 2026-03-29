import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { description, imageBase64, mimeType } = await request.json();

    const content: any[] = [];

    if (imageBase64 && mimeType) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: imageBase64 },
      });
    }

    content.push({
      type: 'text',
      text: `You are a nutrition expert. Estimate calories and protein for this meal.
${description ? `Description: ${description}` : ''}
${imageBase64 ? 'An image is also provided.' : ''}
Respond ONLY with JSON, no other text:
{"calories": <number>, "protein_g": <number>, "notes": "<1 sentence>"}`,
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Analyze error:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
