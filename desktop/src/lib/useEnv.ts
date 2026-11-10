import { useCallback, useEffect, useState } from "react";

export function useEnv() {
  const [env, setEnv] = useState<Record<string, string> | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await window.api.readEnv();
      setEnv(result.masked);
      setPath(result.path);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (patch: Record<string, string>) => {
    const result = await window.api.saveEnv(patch);
    setEnv(result.masked);
    setPath(result.path);
    return result;
  }, []);

  return { env, path, error, reload, save };
}
