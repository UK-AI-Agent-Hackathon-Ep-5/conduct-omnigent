"""Automatic content tagging via Gemini Flash."""

import google.generativeai as genai

genai.configure()


def tag(content: str) -> list[str]:
    model = genai.GenerativeModel("gemini-1.5-flash")
    out = model.generate_content(f"Return comma-separated tags for:\n{content}")
    return [t.strip() for t in out.text.split(",")]
