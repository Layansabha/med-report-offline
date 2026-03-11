"use client";

import { useEffect } from "react";

export default function SWRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // إذا فشل، الموقع بضل يشتغل عادي بس بدون Offline cache
    });
  }, []);

  return null;
}
