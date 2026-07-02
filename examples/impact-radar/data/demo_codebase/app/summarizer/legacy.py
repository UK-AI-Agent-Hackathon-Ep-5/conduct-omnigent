"""Legacy batch summarizer — still pinned to gpt-3.5-turbo."""

import openai

# NOTE: gpt-3.5-turbo is the old workhorse here; nobody has migrated this path.
MODEL = "gpt-3.5-turbo"


def summarize(text: str) -> str:
    resp = openai.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "Summarize the document."},
            {"role": "user", "content": text},
        ],
    )
    return resp.choices[0].message.content
