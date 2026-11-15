# VoxCrew: a real task and three cities

[Watch the 42-second demo](voxcrew-demo.mp4?raw=1) · [Animated preview](voxcrew-demo-preview.gif)

Recorded on Windows on 15 November 2026, using the public free edition at commit [`90241c7`](https://github.com/Mucaktr/voxcrew/commit/90241c7c5b7cf85a7dcbecfeedaef82dbda1e79c), with a separate local demo data directory.

## What happens

| Video time | Recorded action |
| --- | --- |
| 00:00–00:08 | Submit launch notes to the bundled **Quick summary** workflow. |
| 00:08–00:11 | View the Istanbul world while the local agent works. |
| 00:11–00:18 | Inspect the completed five-bullet summary and the model used. |
| 00:18–00:26 | Walk along Istanbul's waterfront. |
| 00:26–00:34 | Walk in Cappadocia and switch to its bird's-eye view. |
| 00:34–00:42 | Walk through London and view its panorama. |

The Researcher used **Ollama `qwen3:4b`**. The task completed in **3 minutes 41 seconds**, with **2,256 tokens** reported by the app. These figures describe this single local run, not a performance benchmark. London was unlocked in the UI using the passport stamp earned by completing the workflow in Istanbul.

This is an **edited screen recording**: waiting and navigation between scenes were removed. The retained footage keeps its recorded timing. Captions were added below the application viewport; the task result and city scenes were not generated or replaced for the video. The app's visible quality score is its own assessment, not an independent evaluation.

## Reproduce the task

1. Follow the [setup guide](../SETUP.md), connect Ollama and download a model suitable for your hardware.
2. Assign `qwen3:4b` to **Researcher** and use read-only permissions.
3. Select **Istanbul**, then open **Workflows → Quick summary → Run**.
4. Paste the following text and start the workflow:

> VoxCrew launch notes: The English and Turkish README are ready. New users need Git, uv and Node.js 20+ for a source install. The free edition supports two active agents. Record a real summary task, then show walks through Istanbul, Cappadocia and London. Publish the demo in the README and collect feedback about setup and first-task experience.

The workflow asks for five bullets, each at most 20 words. The recorded output was:

- English and Turkish README files are ready for VoxCrew launch.
- New users require Git, uv, and Node.js 20+ for source installation.
- Free edition supports two active agents.
- Record real summary tasks and demonstrate walks through Istanbul, Cappadocia, and London.
- Publish demo in README and collect feedback on setup and first-task experience.

After completion, open **World → Walk**. Use WASD to move and Z for the bird's-eye view. Istanbul and Cappadocia are available in the scene picker. In **Achievements → Shop**, use the earned passport stamp to unlock London.

## Media

- Full video: 42 seconds, H.264 MP4, 1280 × 800, 30 fps, silent, about 5.1 MB.
- README preview: a short GIF sampler linked to the full video.
- The MP4 passed a complete decode check; sampled frames were visually reviewed for legibility and framing.
- This demonstrates one local summary workflow and city navigation. It does not validate every provider, tool or supported platform.

## Türkçe

Video, ücretsiz sürümde **Ollama `qwen3:4b`** ile gerçekten tamamlanan bir özet görevini ve **İstanbul, Kapadokya, Londra** gezintilerini gösterir. Görev **3 dakika 41 saniye** sürmüştür; **42 saniyelik kurguda** bekleme ve sahneler arası geçişler kısaltılmıştır. Londra, İstanbul'da tamamlanan iş akışıyla kazanılan pasaport damgası kullanılarak açılmıştır. Uygulama görüntüleri ve görev sonucu gerçektir; açıklama yazıları görüntünün altına eklenmiştir.

[Türkçe kurulum rehberi](../SETUP.tr.md) · [Türkçe README](../../README.tr.md)
