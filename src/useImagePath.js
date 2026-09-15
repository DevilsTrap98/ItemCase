import { useEffect, useState } from 'react';

export default function useImagePath(fileName) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (fileName) {
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
