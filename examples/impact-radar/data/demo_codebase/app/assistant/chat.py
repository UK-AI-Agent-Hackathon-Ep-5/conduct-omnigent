"""Customer-facing chat assistant — primary revenue surface."""

from openai import OpenAI

client = OpenAI()

CHAT_MODEL = "gpt-4o"


def answer(question: str) -> str:
    resp = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[{"role": "user", "content": question}],
    )
    return resp.choices[0].message.content
