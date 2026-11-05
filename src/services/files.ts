/** 浏览器下载 / 分享文件（iOS Safari 优先走分享面板，可存到「文件」） */
export async function saveFile(name: string, content: string, type: string): Promise<void> {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function pickFile(accept: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : undefined);
    };
    input.click();
  });
}
