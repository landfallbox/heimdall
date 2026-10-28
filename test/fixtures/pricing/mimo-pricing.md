# API Pricing

{/* feishu-style:text-align:left */}
**Pay-as-you-go for the Xiaomi MiMo API uses the ordinary API Key of the Open Platform and consumes the account balance based on the actual Token usage, which is not interoperable with the Token Plan package quota.** 

<div className='mdx-highlight mdx-highlight-info' data-highlight-icon='info'>

**Billing Instructions** 

- Billing Unit: China：RMB / M tokens;  Overseas: dollar / M tokens

- Cache Hit: When the requested prefix content hits the Prompt Cache, it will be billed according to the cached hit price.

- Cache Write: Limited-time Free

- ASR series models are billed based on the duration of the input audio: duration statistics are accurate to the second, and ultimately converted to hourly billing

- Internet search is billed independently based on the number of calls and is not included in the Token price

</div>

### Domestic Pricing of the Model

<div className='mdx-highlight mdx-highlight-warning' data-highlight-icon='warning'>

- `mimo-v2.5-pro` and `mimo-v2.5` **were officially deprecated at 10:00 (Beijing time) on October 21,2026. It is recommended to switch to the new version of the models as soon as possible. For details, please refer to** [Model Deprecation](https://mimo.mi.com/docs/zh-CN/updates/deprecate).

</div>

{/* feishu-style:text-align:left */}
**Language Models**

<table>
<colgroup>
<col style="width: 13.46%" />
<col style="width: 44.27%" />
<col style="width: 15.91%" />
<col style="width: 16.91%" />
<col style="width: 9.450000000000003%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Inference Type**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Model Name**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Input (Cache Hit)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Input (Cache Miss)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Output**</span></th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="3"><span style="display: inline-block; width: 100%; text-align: left;">**Real-time API**</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥0.025</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥3.00</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥6.00</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-flash`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥0.02</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥1.00</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥2.00</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro-ultraspeed`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥0.25</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥30.00</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥60.00</span></td>
</tr>
<tr>
<td rowspan="2"><span style="display: inline-block; width: 100%; text-align: left;">**Batch API**</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥0.0125</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥1.50</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥3.00</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-flash`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥0.01</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥0.50</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥1.00</span></td>
</tr>
</tbody>
</table>

> Not support batch API: `mimo-v2.6-pro-ultraspeed`

{/* feishu-style:text-align:left */}
**ASR Series**

<table>
<colgroup>
<col style="width: 41.64%" />
<col style="width: 58.36%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Model Name**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Input audio duration**</span></th>
</tr>
</thead>
<tbody>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-asr`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥0.5 /h</span></td>
</tr>
</tbody>
</table>

{/* feishu-style:text-align:left */}
**TTS Series**

{/* feishu-style:text-align:left */}
Free for a limited time: `mimo-v2.5-tts`, `mimo-v2.5-tts-voiceclone`, `mimo-v2.5-tts-voicedesign` 

{/* feishu-style:text-align:left */}
<br></br>

### Overseas Pricing of the Model 

<div className='mdx-highlight mdx-highlight-warning' data-highlight-icon='warning'>

- `mimo-v2.5-pro` and `mimo-v2.5` **were officially deprecated at 10:00 (Beijing time) on October 21,2026. It is recommended to switch to the new version of the models as soon as possible. For details, please refer to** [Model Deprecation](https://mimo.mi.com/docs/zh-CN/updates/deprecate).

</div>

{/* feishu-style:text-align:left */}
**Language Models**

<table>
<colgroup>
<col style="width: 13.7%" />
<col style="width: 44.1%" />
<col style="width: 15.92%" />
<col style="width: 16.93%" />
<col style="width: 9.349999999999994%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Inference Type**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Model Name**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Input (Cache Hit)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Input (Cache Miss)** </span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Output**</span></th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="3"><span style="display: inline-block; width: 100%; text-align: left;">**Real-time API**</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.0036</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.435</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.87</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-flash`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.0028</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.14</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.28</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro-ultraspeed`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.036</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$4.35</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$8.7</span></td>
</tr>
<tr>
<td rowspan="2"><span style="display: inline-block; width: 100%; text-align: left;">**Batch API**</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-pro`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.0018</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.2175</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.435</span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.6-flash`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.0014</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.07</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.14</span></td>
</tr>
</tbody>
</table>

> Not support batch API: `mimo-v2.6-pro-ultraspeed`

{/* feishu-style:text-align:left */}
**ASR Series**

<table>
<colgroup>
<col style="width: 41.64%" />
<col style="width: 58.36%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Model Name**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Input audio duration**</span></th>
</tr>
</thead>
<tbody>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">`mimo-v2.5-asr`</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$0.074 /h</span></td>
</tr>
</tbody>
</table>

{/* feishu-style:text-align:left */}
**TTS Series**

{/* feishu-style:text-align:left */}
Free for a limited time: `mimo-v2.5-tts`, `mimo-v2.5-tts-voiceclone`, `mimo-v2.5-tts-voicedesign`

{/* feishu-style:text-align:left */}
<br></br>

### Pricing for Web Search Plugins 

<table>
<colgroup>
<col style="width: 21.97%" />
<col style="width: 21.97%" />
<col style="width: 56.06%" />
</colgroup>
<thead>
<tr>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Service Item**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Price**</span></th>
<th><span style="display: inline-block; width: 100%; text-align: left;">**Description**</span></th>
</tr>
</thead>
<tbody>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Domestic Internet Connectivity Service</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">¥16 /1000 times</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Includes web search and web parsing, used for searching relevant content in domestic regional network connections </span></td>
</tr>
<tr>
<td><span style="display: inline-block; width: 100%; text-align: left;">Overseas Internet Connectivity Service </span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">$5 /1000 times</span></td>
<td><span style="display: inline-block; width: 100%; text-align: left;">Includes web search and web parsing, used for networked search of relevant content in overseas regions </span></td>
</tr>
</tbody>
</table>
