export function connectRealtime(options: {
  onOpen?: () => void;
  onEvent: (event: { type: string }) => void;
}) {
  const invalidate = () => options.onEvent({ type: "message.deleted" });
  window.addEventListener("gallery-test-invalidate", invalidate);
  return {
    close() {
      window.removeEventListener("gallery-test-invalidate", invalidate);
    },
  };
}
