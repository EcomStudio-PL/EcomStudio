# ADR-0003 GrovBase prompts stored encrypted
Decision: engine prompts persist only as AES-256-GCM ciphertext
(prompt_encrypted/iv/tag), decrypted server-side at provider dispatch;
never sent to the client; jobs hide prompt text for engine origin.
Why: prompt engineering is the product moat; DB read access (or ciphertext
leak) alone must not expose it. Depends on APP_ENCRYPTION_KEY secrecy —
rotation procedure in Incident Response.
