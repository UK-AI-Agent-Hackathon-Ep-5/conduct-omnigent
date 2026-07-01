"""Long-document analysis via Gemini."""

import google.generativeai as genai

genai.configure()

_MODEL = "gemini-1.5-pro"


def analyze(document: str) -> str:
    model = genai.GenerativeModel(_MODEL)
    return model.generate_content(f"Analyze this document:\n{document}").text
