/** The server tokens, fixed for tests. */
export const dispatchToken = () => "server-token";
export const promptKeyToken = () => "prompt-key-token-for-tests-0000000000";
/** The raw secret (the trial watermark's key wrap derives from it; this suite never wraps). */
export const serverSecret = (): string | null => "server-secret-for-tests-000000000000";
