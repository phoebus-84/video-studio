# TypeScript is the control plane; Python is isolated to MLX

Contracts, runtime, Pi package, fal adapter, graphics renderer, FFmpeg composer, gateway, and web client use TypeScript to share generated bindings and Node/Pi integration directly. The Qwen3-TTS worker remains Python because MLX Audio is its native ecosystem and communicates through a versioned local API; this limits cross-language complexity to a deliberate service boundary.
