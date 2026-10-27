> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimaxi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 模型调用

> MiniMax 语言模型，支持多语言编程、Agent 工作流等复杂任务场景。

## 模型概览

MiniMax 提供多款语言模型，满足不同场景需求。**MiniMax-M3.1-Flash** 是最新 M 系列语言模型，适用于 Agent 推理、工具调用、代码和长上下文任务，并支持通过 `effort` 调节思考深度。**MiniMax-M3** 也正常提供服务。

### 支持模型

| 模型名称 | 上下文窗口 | 模型介绍 |
| :- | :-: | :- |
| MiniMax-M3.1-Flash | 1,000,000 | **原生多模态、1M 上下文的 Frontier Coding 模型，思考深度可调**。一个面向真实工作的日常高效主力模型。 |
| MiniMax-M3 | 1,000,000 | **原生多模态、1M 上下文的 Frontier Coding 模型** |

> [!NOTE]
>
> TPS（Tokens Per Second）的计算方式详见[常见问题 > 接口相关](https://platform.minimaxi.com/docs/faq/about-apis.md#%E9%97%AE%EF%BC%9A%E8%AF%AD%E8%A8%80%E6%A8%A1%E5%9E%8B%E7%9A%84-tps%EF%BC%88tokens-per-second%EF%BC%89%E6%98%AF%E5%A6%82%E4%BD%95%E8%AE%A1%E7%AE%97%E7%9A%84)。

### **MiniMax M3.1-Flash** 核心亮点

> **1M 上下文**
>
> MiniMax-M3.1-Flash 支持最高 1,000,000 token 上下文，适用于长文档、代码库和多步骤 Agent 会话。

> **Agent 与代码场景**
>
> MiniMax-M3.1-Flash 面向 Agent 推理、工具调用、代码和结构化任务执行优化。

> **思考深度可调（effort）**
>
> 通过 `effort` 调节思考深度，可取 `low`、`medium`、`high`、`xhigh`、`max`，档位越高思考越充分。省略时默认使用 `max` 档位。详见[深度思考](#深度思考)。

> **多模态 Chat 输入**
>
> 支持文本、图片和视频等多模态输入，适用于丰富的内容理解与分析场景。

***

## URL 配置

调用 MiniMax 模型前，请先准备好以下信息：

| 字段 | 值 |
| :- | :- |
| `base_url`（Anthropic 兼容，推荐） | `https://api.minimax.cn/anthropic` |
| `base_url`（OpenAI 兼容） | `https://api.minimax.cn/v1` |
| `api_key` | [获取订阅 Key](https://platform.minimax.cn/console/plan) |
| `model` | 见上方[支持模型](#支持模型)表 |

***

## 调用示例

MiniMax 同时兼容 Anthropic 和 OpenAI 两种 API 协议格式，下面给出两套等价的非流式样例。需要流式响应时，把请求里的 `stream` 改成 `true` 即可。

### Anthropic 兼容（推荐）

支持 thinking 块、interleaved thinking 等高级特性，是默认推荐路径。

```bash curl theme={null}
curl https://api.minimax.cn/anthropic/v1/messages \
  -H "Authorization: Bearer <MINIMAX_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M3.1-Flash",
    "output_config": {"effort": "max"},
    "max_tokens": 4096,
    "messages": [
      {"role": "user", "content": "Hi, how are you?"}
    ]
  }'
```

```python Python theme={null}
# 首次使用前请先安装 Anthropic SDK：`pip install anthropic`
import anthropic

client = anthropic.Anthropic(
    base_url="https://api.minimax.cn/anthropic",
    api_key="<MINIMAX_API_KEY>",
)

message = client.messages.create(
    model="MiniMax-M3.1-Flash",
    output_config={"effort": "max"},
    max_tokens=4096,
    messages=[
        {"role": "user", "content": "Hi, how are you?"}
    ],
)

for block in message.content:
    if block.type == "thinking":
        print(f"Thinking:\n{block.thinking}\n")
    elif block.type == "text":
        print(f"Text:\n{block.text}\n")
```

```javascript Node.js theme={null}
// 首次使用前请先安装 Anthropic SDK：`npm install @anthropic-ai/sdk`
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://api.minimax.cn/anthropic",
  apiKey: "<MINIMAX_API_KEY>",
});

const message = await client.messages.create({
  model: "MiniMax-M3.1-Flash",
  output_config: { effort: "max" },
  max_tokens: 4096,
  messages: [
    { role: "user", content: "Hi, how are you?" },
  ],
});

for (const block of message.content) {
  if (block.type === "thinking") {
    console.log(`Thinking:\n${block.thinking}\n`);
  } else if (block.type === "text") {
    console.log(`Text:\n${block.text}\n`);
  }
}
```

### OpenAI 兼容

如果你的项目已经接入 OpenAI SDK，把 `base_url` 和 `model` 换成下方的值即可直接复用，无需迁移到新 SDK。

```bash curl theme={null}
curl https://api.minimax.cn/v1/chat/completions \
  -H "Authorization: Bearer <MINIMAX_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M3.1-Flash",
    "reasoning_effort": "max",
    "messages": [
      {"role": "user", "content": "Hi, how are you?"}
    ]
  }'
```

```python Python theme={null}
# 首次使用前请先安装 OpenAI SDK：`pip install openai`
from openai import OpenAI

client = OpenAI(
    base_url="https://api.minimax.cn/v1",
    api_key="<MINIMAX_API_KEY>",
)

response = client.chat.completions.create(
    model="MiniMax-M3.1-Flash",
    reasoning_effort="max",
    messages=[
        {"role": "user", "content": "Hi, how are you?"},
    ],
)

print(response.choices[0].message.content)
```

```javascript Node.js theme={null}
// 首次使用前请先安装 OpenAI SDK：`npm install openai`
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.minimax.cn/v1",
  apiKey: "<MINIMAX_API_KEY>",
});

const response = await client.chat.completions.create({
  model: "MiniMax-M3.1-Flash",
  reasoning_effort: "max",
  messages: [
    { role: "user", content: "Hi, how are you?" },
  ],
});

console.log(response.choices[0].message.content);
```

***

## 深度思考

MiniMax-M3.1-Flash 在回答前会先进行推理，把复杂问题拆解成多步分析后再作答，在 Agent 推理、工具调用、代码和数学等任务上能明显提升准确性。深度思考**默认开启，无需额外配置**。

思考内容与最终回答分开返回：在 OpenAI 兼容协议下，思考内容固定通过 `reasoning_content` 字段单独给出，`content` 只含最终回答，可以直接用于展示，不需要从 `<think>` 标签里自行解析。

### 思考深度档位（effort）

`effort` 可取 `low`、`medium`、`high`、`xhigh`、`max`，档位越高思考越充分、耗时和输出 token 也越多。`MiniMax-M3.1-Flash` 省略 `effort` 时默认为 `max`。不同协议下的字段名不同：

| 协议 | 思考深度字段 | 思考内容返回位置 | 输出上限字段 |
| :- | :- | :- | :- |
| Anthropic 兼容 | `output_config.effort` | `thinking` 内容块 | `max_tokens` |
| OpenAI 兼容 | `reasoning_effort` | `reasoning_content` 字段 | `max_tokens` / `max_completion_tokens` |
| OpenAI Responses | `reasoning.effort` | `type: "reasoning"` 输出项 | `max_output_tokens` |

Anthropic 兼容接口中，显式设置 `output_config.effort` 为 `max`：

```json theme={null}
{
  "model": "MiniMax-M3.1-Flash",
  "max_tokens": 4096,
  "output_config": {"effort": "max"},
  "messages": [{"role": "user", "content": "你好"}]
}
```

### 使用限制

深度思考不支持关闭。传入 `thinking: {"type": "disabled"}` 或 `effort: "none"` 会返回 `400`：

```text theme={null}
model "MiniMax-M3.1-Flash" requires adaptive thinking
```

如需减少思考带来的耗时和 token 用量，请调低 `effort` 档位，而不是关闭思考。

***

## API 参考

> **[Anthropic API 兼容（推荐）](https://platform.minimaxi.com/docs/api-reference/text-anthropic-api.md)**
>
> 通过 Anthropic SDK 调用 MiniMax 模型，支持流式输出和 Interleaved Thinking

> **[OpenAI API 兼容](https://platform.minimaxi.com/docs/api-reference/text-openai-api.md)**
>
> 通过 OpenAI SDK 调用 MiniMax 模型

> **[在 AI 编程工具里使用 MiniMax M 系列模型](https://platform.minimaxi.com/docs/m-plan/openclaw.md)**
>
> 在 Claude Code、Cursor 等工具中使用 MiniMax M 系列模型

> **[Chat Model](https://platform.minimaxi.com/docs/guides/text-chat)**
>
> M2-her 对话模型，专为角色扮演、多轮对话等场景设计

***

## 联系我们

如果在使用 MiniMax 模型过程中遇到任何问题：

* 通过邮箱 [Model@minimax.io](mailto:Model@minimax.io) 等官方渠道联系我们的技术支持团队
* 在我们的 [Github](https://github.com/MiniMax-AI/MiniMax-M2.7/issues) 仓库提交 Issue

## 相关链接

* [Anthropic SDK 文档](https://docs.anthropic.com/en/api/client-sdks)
* [OpenAI SDK 文档](https://platform.openai.com/docs/libraries)
* [MiniMax M3.1-Flash](https://www.minimax.cn/blog/minimax-m31f)
