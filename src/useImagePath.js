import { useEffect, useState } from 'react';

export default function useImagePath(fileName) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (fileName && fileName.startsWith('data:')) {
      // Already a resolved data URL (e.g. images coming from the community
      // catalog server), no local file lookup needed.
      setSrc(fileName);
    } else if (fileName) {
      window.api.getImagePath(fileName).then((dataUrl) => {
        if (!cancelled && dataUrl) {
          setSrc(dataUrl);
        }
      });
    } else {
      setSrc(null);
    }
    return () => { cancelled = true; };
  }, [fileName]);

  return src;
}
