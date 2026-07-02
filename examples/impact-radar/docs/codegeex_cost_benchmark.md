# CodeGeeX Cost Benchmark

## Why This Project

CodeGeeX is a real open-source AI coding assistant with deployed IDE extensions and published usage telemetry. It is a stronger benchmark than GitHub stars or Docker pulls because the paper reports active users, API-call frequency, and generated-token volume.

## Project Snapshot

| Field | Value |
|---|---|
| Project | CodeGeeX |
| Repository | https://github.com/zai-org/CodeGeeX |
| Product surface | VS Code extension, JetBrains extension, Tencent Cloud Studio extension |
| Open-source components | Model code, model weights, API, extensions, HumanEval-X |
| API use case | Coding assistant backend for completion, generation, translation, explanation, and custom prompting |

## Published Usage Data

| Metric | Published value |
|---|---:|
| Active users | Tens of thousands of daily active users |
| API calls | 200+ API calls per active user per weekday |
| Generated tokens | 8B generated tokens per week |
| User-study result | 83.4% of surveyed users reported improved coding efficiency |

## API Types

- `code_completion`
- `function_level_code_generation`
- `code_translation`
- `code_explanation`
- `custom_prompting`
- `ide_extension_backend_api`

## Cost Calculation

The CodeGeeX paper reports generated tokens, which are treated here as output tokens. The original CodeGeeX service used its own model, so this is a commercial API replacement-cost benchmark, not the historical CodeGeeX infrastructure bill.

```text
weekly_output_tokens = 8,000,000,000
monthly_output_tokens = weekly_output_tokens * 52 / 12
                      = 34,666,666,667
                      = 34,666.67M output tokens/month

input_token_assumption = 50% of output tokens
monthly_input_tokens = 17,333,333,333
                     = 17,333.33M input tokens/month
```

## Estimated Monthly API Cost

| Replacement model | Input price / 1M | Output price / 1M | Input cost / month | Output cost / month | Total cost / month |
|---|---:|---:|---:|---:|---:|
| `gpt-5.2` | $1.75 | $14.00 | $30,333 | $485,333 | $515,667 |
| `gpt-5.1-codex-mini` | $0.25 | $2.00 | $4,333 | $69,333 | $73,667 |

Output-only lower bound for `gpt-5.2`:

```text
34,666.67M output tokens * $14.00 / 1M = $485,333/month
```

## Interpretation

A production-scale open-source coding assistant with CodeGeeX-level usage would cost roughly $516K/month on a high-capability commercial API model such as `gpt-5.2`, assuming input tokens are 50% of generated output tokens. Even a cheaper replacement model such as `gpt-5.1-codex-mini` would still cost roughly $74K/month under the same workload.

## Limitations

- The published token number is generated tokens, not a full input/output billing split.
- The input-token volume is estimated using a transparent 0.5 input-to-output ratio.
- Active users are reported as "tens of thousands," not an exact integer.
- This is a replacement-cost benchmark using OpenAI API pricing, not the actual CodeGeeX operating cost.
- Some paper mirrors mention 4.7B generated tokens per week in abstracts; this note uses the KDD paper text reporting 8B generated tokens per week.

## Sources

- CodeGeeX KDD paper PDF: https://keg.cs.tsinghua.edu.cn/jietang/publications/KDD23-Zheng-CodeGeeX.pdf
- CodeGeeX arXiv page: https://arxiv.org/abs/2303.17568
- CodeGeeX repository: https://github.com/zai-org/CodeGeeX
- OpenAI API pricing: https://platform.openai.com/docs/pricing
- OpenAI GPT-5.2 pricing note: https://openai.com/index/introducing-gpt-5-2/
