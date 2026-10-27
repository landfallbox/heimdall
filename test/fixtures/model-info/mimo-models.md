# Models

{/* feishu-style:text-align:left */}
This page lists all the models currently supported by the Xiaomi MiMo API Open Platform, including model capabilities, length limits, and rate-limiting quotas, to help you select the appropriate model based on your usage scenario. 

### Rate Limiting Instructions

{/* feishu-style:text-align:left */}
The platform sets a model concurrency limit for each account. When the server load is high, response delays or ` 429 ` error may occur. We recommend that you reasonably plan your request frequency and implement request retry and backoff strategies in high-concurrency scenarios to avoid triggering rate limits. 

<div className='mdx-highlight mdx-highlight-info' data-highlight-icon='info'>

- **RPM (Requests Per Minute)** : The maximum number of requests initiated per minute. The calculation scope is the sum of the total number of requests from all API Keys under a single account when calling the same model.

- **TPM (Tokens Per Minute)** : The maximum number of Tokens that can be interacted with per minute. The calculation scope is the sum of the total number of requested Tokens for all API Keys under a single account when calling the same model.

</div>

{/* feishu-style:text-align:left */}
<br></br>

### Text Generation Model

<div className='mdx-highlight mdx-highlight-warning' data-highlight-icon='warning'>

- `mimo-v2.5-pro` and `mimo-v2.5` **were officially deprecated at 10:00 (Beijing time) on October 21,2026. It is recommended to switch to the new version of the models as soon as possible. For details, please refer to** [**Model Deprecation**](https://mimo.mi.com/docs/zh-CN/updates/deprecate)**.**

</div>

<table>
<colgroup>
<col style="width: 29.2%" />
<col style="width: 27.53%" />
<col style="width: 24.67%" />
<col style="width: 18.599999999999994%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Model ID (Model ID)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Capability Support**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Length Limit (token)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Rate Limiting**</span></th>
</tr>
</thead>
<tbody>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro`</span><br /><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-flash`</span></td>
<td rowspan="2"><ul><li>**Full-modal Understanding**</li><li>Text Generation</li><li>Deep Thinking</li><li>Streaming Output</li><li>Function Call</li><li>Structured Output</li><li>Web Search</li></ul></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Context Window: 1M</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Maximum Output: 128K</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Maximum RPM: 100</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Maximum TPM: 10M</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro-ultraspeed`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Context Window: 1M</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Maximum Output: 128K</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Customized services available, please [contact us](https://platform.xiaomimimo.com/contact?userId=2451887661)</span></td>
</tr>
</tbody>
</table>

{/* feishu-style:text-align:left */}
<br></br>

### Automatic Speech Recognition (ASR) Model 

<table>
<colgroup>
<col style="width: 30.04%" />
<col style="width: 26.7%" />
<col style="width: 24.67%" />
<col style="width: 18.590000000000003%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Model ID**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Capability Support**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Length Limit (token)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Rate Limiting**</span></th>
</tr>
</thead>
<tbody>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-asr`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Speech Recognition</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Context Window: 8k</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Maximum Output: 2k </span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Maximum RPM: 100</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Maximum TPM: 10k</span></td>
</tr>
</tbody>
</table>

{/* feishu-style:text-align:left */}
<br></br>

### Text-to-Speech (TTS) Model

<table>
<colgroup>
<col style="width: 30.04%" />
<col style="width: 26.7%" />
<col style="width: 24.67%" />
<col style="width: 18.590000000000003%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Model ID (Model ID)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Capability Support**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Length Limit (token)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Rate Limiting**</span></th>
</tr>
</thead>
<tbody>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-tts`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Speech Synthesis</span></td>
<td rowspan="3"><span style="display: inline-block; width: 100%; text-align: left;">Context Window: 8K</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Maximum Output: 8K </span></td>
<td rowspan="3"><span style="display: inline-block; width: 100%; text-align: left;">Maximum RPM: 100</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Maximum TPM: 10M</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-tts-voiceclone`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Speech Synthesis</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Timbre Cloning</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-tts-voicedesign`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Speech Synthesis</span><br /><span style="display: inline-block; width: 100%; text-align: left;">Timbre Design</span></td>
</tr>
</tbody>
</table>

{/* feishu-style:text-align:left */}
<br></br>

### Quick Selection Guide

<table>
<colgroup>
<col style="width: 63.03%" />
<col style="width: 36.97%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">Requirement Scenario</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">Recommendation Model</span></th>
</tr>
</thead>
<tbody>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Complex projects, long-term tasks, high-value work, cybersecurity and scientific research requirements</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro`</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Frequent Calls and Large-Scale Tasks in Professional Office Scenarios</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-flash`</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Production scenarios with strong real-time interaction and sensitivity to response speed</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro-ultraspeed`</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Speech-to-Text (supports Chinese and English)</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-asr`</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Text-to-Speech (Standard Preset Voice)</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-tts`</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Voice Cloning (Upload Audio Sample)</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-tts-voiceclone`</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Custom Timbre Design</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-tts-voicedesign`</span></td>
</tr>
</tbody>
</table>
