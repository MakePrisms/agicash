type ShareData = {
  title?: string;
  text?: string;
  url?: string;
};

// navigatior.share has limited support
export const canShare = (): boolean => {
  return typeof navigator !== 'undefined' && !!navigator.share;
};

export const shareContent = async (data: ShareData): Promise<boolean> => {
  if (!canShare()) {
    return false;
  }

  try {
    await navigator.share(data);
    return true;
  } catch (error) {
    console.error('Share error', { cause: error });
    return false;
  }
};
