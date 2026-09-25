export const showWebGLFallback = (container: HTMLElement, canvas: HTMLCanvasElement, label: string): (() => void) => {
  canvas.style.display = 'none';
  const notice = document.createElement('div');
  notice.setAttribute('role', 'status');
  notice.style.cssText = 'display:grid;place-items:center;height:100%;min-height:120px;padding:1rem;color:#64748b;background:rgba(2,4,12,.8);font:10px monospace;letter-spacing:.08em;text-align:center;text-transform:uppercase';
  notice.textContent = `${label} requires WebGL; the rest of SID OS remains available.`;
  container.appendChild(notice);
  return () => notice.remove();
};

export const supportsWebGL = (canvas: HTMLCanvasElement): boolean => {
  try {
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
};
