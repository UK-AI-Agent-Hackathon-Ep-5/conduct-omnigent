"""Inline autocomplete."""

from openai import OpenAI

client = OpenAI()


def complete(prefix: str) -> str:
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prefix}],
        max_tokens=64,
    )
    return resp.choices[0].message.content
