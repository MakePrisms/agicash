export async function readClipboard(): Promise<string | null> {
  try {
    const text = await navigator.clipboard.readText();
    return text || null;
  } catch {
    return null;
  }
}
