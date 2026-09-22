import { useEffect, useState } from 'react';

export default function useImagePath(fileName) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (fileName && (fileName.startsWith('data:') || /^https?:\/\//i.test(fileName))) {
      // Already resolved by the server; no local file lookup needed.
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
