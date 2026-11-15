"use strict";

// All content and navigation work without JavaScript. No analytics or requests.
const videos = [...document.querySelectorAll("video")];
for (const video of videos) {
  video.addEventListener("play", () => {
    for (const other of videos) {
      if (other !== video) other.pause();
    }
  });
}

const copyButton = document.querySelector("[data-copy-target]");
if (copyButton && window.isSecureContext && navigator.clipboard) {
  copyButton.hidden = false;
  copyButton.addEventListener("click", async () => {
    const target = document.getElementById(copyButton.dataset.copyTarget);
    const status = document.querySelector("[data-copy-status]");
    if (!target || !status) return;
    try {
      await navigator.clipboard.writeText(target.innerText.trim());
      status.textContent = copyButton.dataset.success;
    } catch {
      status.textContent = copyButton.dataset.failure;
    }
  });
}
