import React, { useState } from "react";
import { nextAvatarSource } from "../../lib/bot-avatar-packs";

// The Svelte host supplies sources; React owns only image-load failure state.
export function BotAvatarImage({
  id,
  name,
  candidates = [],
}: {
  id?: string;
  name?: string;
  candidates?: string[];
}) {
  const [failed, setFailed] = useState<{ key: string; sources: string[] }>({
    key: "",
    sources: [],
  });
  const key = JSON.stringify([id, candidates]);
  const source = nextAvatarSource(candidates, key === failed.key ? failed.sources : []);
  return source ? (
    <img
      src={source}
      alt=""
      width={24}
      height={24}
      loading="lazy"
      decoding="async"
      onError={() =>
        setFailed({ key, sources: [...(failed.key === key ? failed.sources : []), source] })
      }
    />
  ) : (
    <>{(name || "?").slice(0, 1).toUpperCase()}</>
  );
}
