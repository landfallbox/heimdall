> ## Documentation Index
> Fetch the complete documentation index at: https://platform.stepfun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# API 定价

API 调用按实际用量计费，单价以人民币计价。

## 文本与多模态模型

> [!NOTE]
>
> Step 5 Preview 的缓存命中输入价格自北京时间 2026 年 10 月 14 日 00:30 起由 0.35 元／百万 tokens 调整为 0.70 元／百万 tokens。在该时间之前已通过按量付费 API 调用过 Step 5 Preview 的用户，继续适用 0.35 元／百万 tokens。详见[价格调整公告](https://platform.stepfun.com/docs/zh/announcements/step-5-preview-price-adjustment.md)。

单位：元／百万 tokens。

| Model ID | 输入价格（缓存未命中） | 输入价格（缓存命中） | 输出价格 |
| - | - | - | - |
| `step-5-preview` | 7 | 0.70 | 20 |
| `step-3.7-flash` | 1.35 | 0.27 | 8.1 |
| `step-3.5-flash` | 0.7 | 0.14 | 2.1 |
| `step-3.5-flash-2603` | 0.7 | 0.14 | 2.1 |
| `step-1o-turbo-vision` | 2.5 | 0.5 | 8 |

## 语音模型

### 按 Token 计费

单位：元／百万 tokens。

| Model ID | 输入价格（缓存未命中） | 输入价格（缓存命中） | 输出价格 | 状态 |
| - | - | - | - | - |
| `stepaudio-3-realtime-preview` | — | — | — | 限时免费 |
| `stepaudio-3-chat-preview` | — | — | — | 限时免费 |
| `stepaudio-2.5-realtime` | 10 | 2 | 70 | 按量计费 |
| `stepaudio-2.5-chat` | 10 | 2 | 25 | 按量计费 |
| `step-1o-audio` | 25 | 5 | 60 | 按量计费 |
| `step-audio-2` | 10 | 2 | 70 | 按量计费 |
| `step-audio-r1.5` | 10 | 2 | 105 | 按量计费 |

### 语音合成

| Model ID | 单价 |
| - | - |
| `stepaudio-3-tts` | 2.5 元／万字符 |
| `stepaudio-2.5-tts` | 5.8 元／万字符 |
| `step-tts-2` | 2.8 元／万字符 |
| `step-tts-mini` | 0.9 元／万字符 |

> [!NOTE]
>
> 此处 1 个汉字算 1 个字符，2 个英文字母算 1 个字符，2 个标点符号算 1 个字符。

### 语音复刻

| Model ID | 单价 |
| - | - |
| `stepaudio-3-tts`、`stepaudio-2.5-tts`、`step-tts-2`、`step-tts-mini` | 9.9 元／音色，试听接口仅收合成费用；正式复刻成功立即收费 |

### 音频与音乐生成

| Model ID | 状态 |
| - | - |
| `stepaudio-3-gen-preview` | 限时免费 |
| `stepaudio-3-music-preview` | 限时免费 |

### 语音识别

| Model ID | 单价 |
| - | - |
| `stepaudio-3-asr-max` | 2.8 元／小时 |
| `stepaudio-2.5-asr` | 0.15 元／小时 |
| `stepaudio-2.5-asr-stream` | 1.2 元／小时 |
| `stepaudio-2-asr-pro` | 2 元／小时 |
| `step-asr` | 0.9 元／小时 |
| `step-asr-1.1` | 2.2 元／小时 |
| `step-asr-1.1-stream` | 2.6 元／小时 |

## 增值能力

| 能力 | 单价 |
| - | - |
| 互联网搜索 | 0.04 元／次 |
| 文搜图 | 0.12 元／次 |
| 文件存储 | 0.5 元／GB／天 |


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.